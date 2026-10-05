import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";

import { HttpError } from "../../shared/errors/http-error";
import { USER_ROLES, type UserRole } from "../users/user.entity";
import type { AuthContext } from "./authenticate.middleware";

type TokenServiceOptions = {
  secret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
};

export type AccessToken = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

export type RefreshToken = {
  /** Opaque value handed to the client. Only its hash is stored. */
  token: string;
  hash: string;
  expiresAt: Date;
};

const isUserRole = (value: unknown): value is UserRole =>
  USER_ROLES.includes(value as UserRole);

/**
 * Hashes a refresh token for storage and lookup. SHA-256 is enough here: the
 * token is 256 random bits, so it cannot be brute-forced like a password.
 */
export const hashRefreshToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/**
 * Issues and verifies tokens.
 *
 * - Access tokens: short-lived HS256 JWTs (subject = user id, `role` claim).
 *   Stateless, so a role change applies once the current token expires.
 * - Refresh tokens: long-lived random strings, persisted (hashed) so they can
 *   be rotated and revoked.
 */
export class TokenService {
  constructor(private readonly options: TokenServiceOptions) {}

  get refreshTokenTtlSeconds() {
    return this.options.refreshTokenTtlSeconds;
  }

  signAccessToken(userId: string, role: UserRole): AccessToken {
    const accessToken = jwt.sign({ role }, this.options.secret, {
      algorithm: "HS256",
      subject: userId,
      expiresIn: this.options.accessTokenTtlSeconds,
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: this.options.accessTokenTtlSeconds,
    };
  }

  createRefreshToken(): RefreshToken {
    const token = randomBytes(32).toString("base64url");

    return {
      token,
      hash: hashRefreshToken(token),
      expiresAt: new Date(
        Date.now() + this.options.refreshTokenTtlSeconds * 1000,
      ),
    };
  }

  /**
   * Returns the caller encoded in an access token, or throws a 401 HttpError.
   */
  verifyAccessToken(token: string): AuthContext {
    try {
      // Pinning the algorithm blocks "alg: none" and algorithm-confusion
      // tokens.
      const payload = jwt.verify(token, this.options.secret, {
        algorithms: ["HS256"],
      });

      if (
        typeof payload === "string" ||
        !payload.sub ||
        !isUserRole(payload.role)
      ) {
        throw new jwt.JsonWebTokenError("Malformed token payload");
      }

      return { userId: payload.sub, role: payload.role };
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw HttpError.unauthorized("Access token has expired", {
          errorCode: "TOKEN_EXPIRED",
        });
      }

      if (error instanceof jwt.JsonWebTokenError) {
        throw HttpError.unauthorized("Invalid access token", {
          errorCode: "INVALID_TOKEN",
        });
      }

      throw error;
    }
  }
}
