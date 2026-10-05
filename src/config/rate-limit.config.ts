import { rateLimit } from "express-rate-limit";
import { StatusCodes } from "http-status-codes";

import { sendError } from "../shared/http/response";
import { env } from "./env";

/**
 * Creates the per-IP limiter for all routes.
 *
 * A factory (instead of a module-level instance) gives every app instance its
 * own counters, which keeps tests isolated. The in-memory store is per
 * process; use a shared store (e.g. rate-limit-redis) when running more than
 * one instance.
 */
export const createGlobalLimiter = () =>
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(
        res,
        StatusCodes.TOO_MANY_REQUESTS,
        "Too many requests, please try again later.",
        "TOO_MANY_REQUESTS",
      );
    },
  });

/**
 * Stricter per-IP limiter for credential endpoints (login, register).
 *
 * Only failed requests count, so legitimate users are not locked out while
 * password guessing is slowed down to 10 attempts per 15 minutes.
 */
export const createAuthenticationLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(
        res,
        StatusCodes.TOO_MANY_REQUESTS,
        "Too many attempts, please try again later.",
        "TOO_MANY_REQUESTS",
      );
    },
  });
