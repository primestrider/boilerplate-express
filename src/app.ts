import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";

import type { Env } from "./config/env";
import { createCorsOptions } from "./config/cors.config";
import { createGlobalLimiter } from "./config/rate-limit.config";
import type { DB } from "./db";
import { createRoutes } from "./routes";
import { createErrorMiddleware } from "./shared/middlewares/error.middleware";
import { notFoundMiddleware } from "./shared/middlewares/not-found.middleware";
import { requestIdMiddleware } from "./shared/middlewares/request-id.middleware";
import { requestLoggerMiddleware } from "./shared/middlewares/request-logger.middleware";

/**
 * Everything the app needs from the outside world.
 *
 * server.ts passes the real database and the parsed environment; tests pass
 * an in-memory database and can override any config value.
 */
export type AppDependencies = {
  db: DB;
  config: Env;
};

/**
 * Builds the Express application without starting an HTTP server.
 */
export const createApp = ({ db, config }: AppDependencies): Express => {
  const app = express();

  // Number of reverse proxies in front of the app (nginx, load balancer).
  app.set("trust proxy", config.TRUST_PROXY);

  // Observability first, so rejected requests are still logged.
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Security before body parsing, so rejected requests are never parsed.
  app.use(helmet());
  app.use(cors(createCorsOptions(config.CORS_ORIGIN)));
  app.use(createGlobalLimiter(config.RATE_LIMIT_MAX));

  // JSON only, with a size cap.
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", createRoutes({ db, config }));

  app.use(notFoundMiddleware);
  // Must be registered last.
  app.use(
    createErrorMiddleware({ exposeStack: config.NODE_ENV !== "production" }),
  );

  return app;
};
