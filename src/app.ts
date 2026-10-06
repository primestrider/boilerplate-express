import express, { type Express } from "express";
import compression from "compression";
import cors from "cors";
import helmet from "helmet";
import type Redis from "ioredis";

import type { Env } from "./config/env";
import { createCorsOptions } from "./config/cors.config";
import { createGlobalLimiter } from "./config/rate-limit.config";
import type { DB } from "./db";
import type { JobQueue } from "./jobs/jobs";
import { createRoutes } from "./routes";
import type { Cache } from "./shared/cache/cache";
import { createErrorMiddleware } from "./shared/middlewares/error.middleware";
import { notFoundMiddleware } from "./shared/middlewares/not-found.middleware";
import { requestIdMiddleware } from "./shared/middlewares/request-id.middleware";
import { requestLoggerMiddleware } from "./shared/middlewares/request-logger.middleware";
import type { FileStorage } from "./shared/storage/file-storage";

/**
 * Everything the app needs from the outside world.
 *
 * server.ts passes the real database, Redis-backed services and the parsed
 * environment; tests pass a test database, in-memory services and can
 * override any config value.
 */
export type AppDependencies = {
  db: DB;
  config: Env;
  /** Shared rate-limit counters and readiness check; optional. */
  redis: Redis | undefined;
  cache: Cache;
  jobQueue: JobQueue;
  storage: FileStorage;
};

/**
 * Builds the Express application without starting an HTTP server.
 */
export const createApp = (dependencies: AppDependencies): Express => {
  const { config, redis } = dependencies;
  const app = express();

  // Number of reverse proxies in front of the app (nginx, load balancer).
  app.set("trust proxy", config.TRUST_PROXY);

  // Observability first, so rejected requests are still logged.
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Security before body parsing, so rejected requests are never parsed.
  app.use(helmet());
  app.use(cors(createCorsOptions(config.CORS_ORIGIN)));
  app.use(createGlobalLimiter(config.RATE_LIMIT_MAX, redis));

  // gzip/brotli for responses over 1kb. Express already sends weak ETags
  // and answers If-None-Match with 304 for GET responses.
  app.use(compression());

  // JSON only, with a size cap. Multipart uploads are parsed per route.
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", createRoutes(dependencies));

  app.use(notFoundMiddleware);
  // Must be registered last.
  app.use(
    createErrorMiddleware({ exposeStack: config.NODE_ENV !== "production" }),
  );

  return app;
};
