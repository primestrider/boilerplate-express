import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./config/env";
import { corsOptions } from "./config/cors.config";
import { createGlobalLimiter } from "./config/rate-limit.config";
import type { DB } from "./db";
import { createRoutes } from "./routes";
import { errorMiddleware } from "./shared/middlewares/error.middleware";
import { notFoundMiddleware } from "./shared/middlewares/not-found.middleware";
import { requestIdMiddleware } from "./shared/middlewares/request-id.middleware";
import { requestLoggerMiddleware } from "./shared/middlewares/request-logger.middleware";

/**
 * Infrastructure the app needs from the outside world.
 *
 * server.ts creates the real instances; tests pass their own (e.g. an
 * in-memory database).
 */
export type AppDependencies = {
  db: DB;
};

/**
 * Builds the Express application without starting an HTTP server.
 */
export const createApp = (deps: AppDependencies): Express => {
  const app = express();

  // Number of reverse proxies in front of the app (nginx, load balancer).
  app.set("trust proxy", env.TRUST_PROXY);

  // Observability first, so rejected requests are still logged.
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Security before body parsing, so rejected requests are never parsed.
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(createGlobalLimiter());

  // JSON only, with a size cap.
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", createRoutes(deps));

  app.use(notFoundMiddleware);
  // Must be registered last.
  app.use(errorMiddleware);

  return app;
};
