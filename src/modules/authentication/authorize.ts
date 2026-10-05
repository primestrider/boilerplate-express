import type { RequestHandler } from "express";

import { HttpError } from "../../shared/errors/http-error";
import type { UserRole } from "../users/user.entity";
import { getAuth, type AuthContext } from "./authenticate.middleware";

const forbidden = () =>
  HttpError.forbidden("You do not have permission to perform this action", {
    errorCode: "FORBIDDEN",
  });

/**
 * Middleware that allows only the given roles. Place it after `authenticate`.
 *
 * It never reads the request, so it is typed to fit in front of any handler
 * (whatever its params/body/query types are).
 */
export const requireRole =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...roles: UserRole[]): RequestHandler<any, any, any, any> =>
    (_req, res, next) => {
      if (!roles.includes(getAuth(res).role)) {
        throw forbidden();
      }

      next();
    };

/**
 * Throws 403 unless the caller owns the resource or has one of the roles.
 * Call it before loading the resource, so the answer never reveals whether a
 * resource owned by another user exists.
 */
export const assertOwnerOrRole = (
  auth: AuthContext,
  ownerId: string,
  ...roles: UserRole[]
) => {
  if (auth.userId !== ownerId && !roles.includes(auth.role)) {
    throw forbidden();
  }
};
