import type { RequestHandler, Response } from "express";

import { HttpError } from "../../shared/errors/http-error";
import type { UserRole } from "../users/user.entity";
import type { TokenService } from "./token.service";

export type AuthContext = {
  userId: string;
  role: UserRole;
};

declare global {
  namespace Express {
    interface Locals {
      /** Set by `authenticate` on protected routes. */
      auth?: AuthContext;
    }
  }
}

/**
 * Creates a middleware that requires a valid `Authorization: Bearer <token>`
 * header and stores the caller in `res.locals.auth`.
 */
export const createAuthenticate =
  (tokenService: TokenService): RequestHandler =>
  (req, res, next) => {
    // RFC 6750: a 401 must tell the client which scheme to use.
    res.set("WWW-Authenticate", "Bearer");

    const [scheme, token] = req.get("Authorization")?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
      throw HttpError.unauthorized("Authentication required", {
        errorCode: "UNAUTHORIZED",
      });
    }

    res.locals.auth = tokenService.verifyAccessToken(token);
    res.removeHeader("WWW-Authenticate");

    next();
  };

/**
 * Reads the caller set by `authenticate`. Use it only on protected routes.
 */
export const getAuth = (res: Response): AuthContext => {
  if (!res.locals.auth) {
    throw new Error("getAuth() called on a route without authenticate");
  }

  return res.locals.auth;
};
