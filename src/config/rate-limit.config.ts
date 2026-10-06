import { rateLimit, type Store } from "express-rate-limit";
import { StatusCodes } from "http-status-codes";
import type Redis from "ioredis";
import { RedisStore, type RedisReply } from "rate-limit-redis";

import { sendError } from "../shared/http/response";

/**
 * Shared counters in Redis, so every app instance enforces one limit. Without
 * Redis the limiters keep the default in-memory store: each process counts on
 * its own, which is fine for a single instance. The limiters are factories so
 * every app gets its own counters, which keeps tests isolated.
 *
 * If Redis is unreachable the limiters let requests through (fail open)
 * instead of turning every request into a 500.
 */
const createRedisStore = (redis: Redis, prefix: string): Store =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });

/**
 * Creates the per-IP limiter for all routes.
 */
export const createGlobalLimiter = (limit: number, redis?: Redis) =>
  rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...(redis && {
      store: createRedisStore(redis, "global"),
      passOnStoreError: true,
    }),
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
export const createAuthenticationLimiter = (redis?: Redis) =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    ...(redis && {
      store: createRedisStore(redis, "authentication"),
      passOnStoreError: true,
    }),
    handler: (_req, res) => {
      sendError(
        res,
        StatusCodes.TOO_MANY_REQUESTS,
        "Too many attempts, please try again later.",
        "TOO_MANY_REQUESTS",
      );
    },
  });
