import { randomUUID } from "node:crypto";

import { logger } from "../../config/logger";
import type { JobQueue } from "../../jobs/jobs";
import { HttpError } from "../../shared/errors/http-error";
import type { MailMessage } from "../../shared/mail/mailer";
import type { AuditService } from "../audit/audit.service";
import type { User } from "../users/user.entity";
import type { UserRepository } from "../users/user.repository";
import type { UserService } from "../users/user.service";
import { passwordChangedEmail, welcomeEmail } from "./authentication.emails";
import type {
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from "./authentication.schema";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import type { RefreshTokenRepository } from "./refresh-token.repository";
import {
  hashRefreshToken,
  type AccessToken,
  type TokenService,
} from "./token.service";

export type TokenPair = AccessToken & {
  refreshToken: string;
  refreshExpiresIn: number;
};

export type AuthenticationResult = TokenPair & { user: User };

const invalidCredentials = () =>
  HttpError.unauthorized("Invalid email or password", {
    errorCode: "INVALID_CREDENTIALS",
  });

const invalidRefreshToken = () =>
  HttpError.unauthorized("Invalid or expired refresh token", {
    errorCode: "INVALID_REFRESH_TOKEN",
  });

type AuthenticationServiceDependencies = {
  userService: UserService;
  userRepository: UserRepository;
  refreshTokenRepository: RefreshTokenRepository;
  tokenService: TokenService;
  auditService: AuditService;
  jobQueue: JobQueue;
};

/**
 * Registration, login, token refresh, logout and password changes.
 *
 * User creation rules (e.g. unique email) stay in UserService; this service
 * adds password and token handling on top.
 */
export class AuthenticationService {
  /**
   * Hash verified when the email is unknown, so both failure paths take about
   * the same time and response timing does not reveal which emails exist.
   */
  private readonly dummyHash = hashPassword("dummy-password-for-timing");

  private readonly userService: UserService;
  private readonly userRepository: UserRepository;
  private readonly refreshTokenRepository: RefreshTokenRepository;
  private readonly tokenService: TokenService;
  private readonly auditService: AuditService;
  private readonly jobQueue: JobQueue;

  constructor(deps: AuthenticationServiceDependencies) {
    this.userService = deps.userService;
    this.userRepository = deps.userRepository;
    this.refreshTokenRepository = deps.refreshTokenRepository;
    this.tokenService = deps.tokenService;
    this.auditService = deps.auditService;
    this.jobQueue = deps.jobQueue;
  }

  async register(input: RegisterDto): Promise<AuthenticationResult> {
    const user = await this.userService.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });

    await this.auditService.record({
      action: "auth.registered",
      entityType: "user",
      entityId: user.id,
      actorId: user.id,
    });
    await this.notify(welcomeEmail(user));

    return { user, ...(await this.issueTokens(user, randomUUID())) };
  }

  async login(input: LoginDto): Promise<AuthenticationResult> {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
      await verifyPassword(await this.dummyHash, input.password);
      await this.recordFailedLogin(null);
      throw invalidCredentials();
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      await this.recordFailedLogin(user.id);
      throw invalidCredentials();
    }

    if (needsRehash(user.passwordHash)) {
      await this.userRepository.updatePasswordHash(
        user.id,
        await hashPassword(input.password),
      );
    }

    await this.auditService.record({
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      actorId: user.id,
    });

    // Every login starts a new token family (one per device/session).
    return { user, ...(await this.issueTokens(user, randomUUID())) };
  }

  /**
   * Exchanges a refresh token for a new token pair (rotation). Each refresh
   * token works once; presenting a used one means it leaked, so the whole
   * family (session) is revoked.
   */
  async refresh({ refreshToken }: RefreshDto): Promise<AuthenticationResult> {
    const stored = await this.refreshTokenRepository.findByHash(
      hashRefreshToken(refreshToken),
    );

    if (!stored || stored.expiresAt <= new Date()) {
      throw invalidRefreshToken();
    }

    if (!(await this.refreshTokenRepository.revokeIfActive(stored.id))) {
      await this.refreshTokenRepository.revokeFamily(stored.familyId);
      logger.warn("Refresh token reuse detected, session revoked", {
        userId: stored.userId,
        familyId: stored.familyId,
      });
      await this.auditService.record({
        action: "auth.refresh_token_reused",
        entityType: "user",
        entityId: stored.userId,
        actorId: null,
        metadata: { familyId: stored.familyId },
      });
      throw invalidRefreshToken();
    }

    // A deleted user's tokens stay in the table but are useless from here.
    const user = await this.userRepository.findById(stored.userId);

    if (!user) throw invalidRefreshToken();

    return { user, ...(await this.issueTokens(user, stored.familyId)) };
  }

  /**
   * Ends the session the refresh token belongs to. Unknown tokens are
   * ignored, so the endpoint reveals nothing about token validity.
   */
  async logout({ refreshToken }: RefreshDto): Promise<void> {
    const stored = await this.refreshTokenRepository.findByHash(
      hashRefreshToken(refreshToken),
    );

    if (stored) {
      await this.refreshTokenRepository.revokeFamily(stored.familyId);
    }
  }

  /**
   * Changes the caller's password after checking the current one, then ends
   * every session: whoever might know the old password is signed out.
   */
  async changePassword(
    userId: string,
    { currentPassword, newPassword }: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.userService.findById(userId);

    if (!(await verifyPassword(user.passwordHash, currentPassword))) {
      throw HttpError.badRequest("Current password is incorrect", {
        errorCode: "INVALID_CURRENT_PASSWORD",
      });
    }

    await this.userRepository.updatePasswordHash(
      user.id,
      await hashPassword(newPassword),
    );
    await this.refreshTokenRepository.revokeAllForUser(user.id);
    await this.auditService.record({
      action: "auth.password_changed",
      entityType: "user",
      entityId: user.id,
    });
    await this.notify(passwordChangedEmail(user));
  }

  /**
   * Queues a notification email. Best effort: the action it reports already
   * succeeded, so a queue outage is logged instead of failing the request.
   */
  private async notify(message: MailMessage) {
    try {
      await this.jobQueue.add("send-email", message);
    } catch (error) {
      logger.error("Failed to queue email", {
        subject: message.subject,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private recordFailedLogin(userId: string | null) {
    return this.auditService.record({
      action: "auth.login_failed",
      entityType: "user",
      entityId: userId,
      actorId: null,
    });
  }

  private async issueTokens(user: User, familyId: string): Promise<TokenPair> {
    const refresh = this.tokenService.createRefreshToken();

    await this.refreshTokenRepository.create({
      userId: user.id,
      tokenHash: refresh.hash,
      familyId,
      expiresAt: refresh.expiresAt,
    });

    return {
      ...this.tokenService.signAccessToken(user.id, user.role),
      refreshToken: refresh.token,
      refreshExpiresIn: this.tokenService.refreshTokenTtlSeconds,
    };
  }
}
