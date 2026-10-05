import jwt from "jsonwebtoken";

import { HttpError } from "../../shared/errors/http-error";

type TokenServiceOptions = {
  secret: string;
  ttlSeconds: number;
};

export type AccessToken = {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
};

/**
 * Issues and verifies HS256 access tokens whose subject is the user id.
 */
export class TokenService {
  constructor(private readonly options: TokenServiceOptions) {}

  sign(userId: string): AccessToken {
    const accessToken = jwt.sign({}, this.options.secret, {
      algorithm: "HS256",
      subject: userId,
      expiresIn: this.options.ttlSeconds,
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: this.options.ttlSeconds,
    };
  }

  /**
   * Returns the user id, or throws a 401 HttpError.
   */
  verify(token: string): string {
    try {
      // Pinning the algorithm blocks "alg: none" and algorithm-confusion
      // tokens.
      const payload = jwt.verify(token, this.options.secret, {
        algorithms: ["HS256"],
      });

      if (typeof payload === "string" || !payload.sub) {
        throw new jwt.JsonWebTokenError("Token has no subject");
      }

      return payload.sub;
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
