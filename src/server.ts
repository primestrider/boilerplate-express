import Redis from "ioredis";

import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { createDatabase } from "./db";
import {
  BullJobQueue,
  createJobHandlers,
  InlineJobQueue,
  type JobQueue,
} from "./jobs/jobs";
import { DrizzleRefreshTokenRepository } from "./modules/authentication/refresh-token.repository";
import { MemoryCache, RedisCache, type Cache } from "./shared/cache/cache";
import { NodemailerMailer } from "./shared/mail/mailer";
import { LocalFileStorage } from "./shared/storage/file-storage";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const db = createDatabase(env.DATABASE_URL);

// With Redis, state is shared by every instance and jobs go to the worker
// process; without it everything stays in this process.
//
// Commands fail fast while Redis is down instead of waiting in ioredis's
// offline queue through every reconnect attempt, which would stall each
// request (the rate limiter touches Redis on every one). Callers then fall
// back: limiters and the user cache let requests through.
const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 1000 })
  : undefined;

// ioredis reconnects on its own; log instead of an unhandled 'error' event.
redis?.on("error", (error) => {
  logger.error("Redis connection error", { error: error.message });
});

const cache: Cache = redis ? new RedisCache(redis) : new MemoryCache();
const jobQueue: JobQueue = redis
  ? new BullJobQueue(redis)
  : new InlineJobQueue(
      createJobHandlers({
        mailer: new NodemailerMailer(env),
        refreshTokenRepository: new DrizzleRefreshTokenRepository(db),
      }),
    );

if (!redis) {
  logger.warn(
    "REDIS_URL is not set: cache, rate limits and jobs are in-process only, and scheduled jobs do not run",
  );
}

const app = createApp({
  db,
  config: env,
  redis,
  cache,
  jobQueue,
  storage: new LocalFileStorage(env.UPLOAD_DIR),
});

const server = app.listen(env.PORT, (error) => {
  if (error) {
    logger.error("Failed to start server", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }

  logger.info(`Server running on http://localhost:${env.PORT}`);
});

/** Closes every connection opened above, after the HTTP server stopped. */
const closeResources = async () => {
  await jobQueue.close();
  await Promise.all([db.$client.end(), redis?.quit()]);
};

let isShuttingDown = false;

/**
 * Stops accepting connections, waits for in-flight requests, then closes the
 * database, Redis and the job queue. Exits forcefully if that takes longer
 * than SHUTDOWN_TIMEOUT_MS.
 */
const shutdown = (reason: string, exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${reason} received. Shutting down gracefully...`);

  setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close((error) => {
    closeResources()
      .catch((closeError: unknown) => {
        logger.error("Failed to close resources", {
          error:
            closeError instanceof Error
              ? closeError.message
              : String(closeError),
        });
        exitCode = 1;
      })
      .finally(() => {
        logger.info("Process terminated");
        process.exit(error ? 1 : exitCode);
      });
  });

  // Idle keep-alive sockets would otherwise hold server.close() open.
  server.closeIdleConnections();
};

process.on("uncaughtException", (error) => {
  // State may be corrupted, so exit immediately instead of draining.
  logger.error("Uncaught exception", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  shutdown("unhandledRejection", 1);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
