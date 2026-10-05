import { randomUUID } from "node:crypto";

import { logger } from "../../config/logger";
import { HttpError } from "../../shared/errors/http-error";
import type { User } from "../users/user.entity";
import type { UserRepository } from "../users/user.repository";
import type { UserService } from "../users/user.service";
import type {
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

/**
 * Registration, login, token refresh and logout.
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

  constructor(
    private readonly userService: UserService,
    private readonly userRepository: UserRepository,
    private readonly refreshTokenRepository: RefreshTokenRepository,
    private readonly tokenService: TokenService,
  ) {}

  async register(input: RegisterDto): Promise<AuthenticationResult> {
    const user = await this.userService.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });

    return { user, ...(await this.issueTokens(user, randomUUID())) };
  }

  async login(input: LoginDto): Promise<AuthenticationResult> {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
      await verifyPassword(await this.dummyHash, input.password);
      throw invalidCredentials();
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw invalidCredentials();
    }

    if (needsRehash(user.passwordHash)) {
      await this.userRepository.updatePasswordHash(
        user.id,
        await hashPassword(input.password),
      );
    }

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
      throw invalidRefreshToken();
    }

    // Deleted users take their tokens with them (ON DELETE CASCADE), so the
    // user is expected to exist here.
    const user = await this.userService.findById(stored.userId);

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
