import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { createDatabase } from "./db";

const SHUTDOWN_TIMEOUT_MS = 10_000;

const db = createDatabase(env.DATABASE_URL);
const app = createApp({ db });

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

let isShuttingDown = false;

/**
 * Stops accepting connections, waits for in-flight requests, then closes the
 * database. Exits forcefully if that takes longer than SHUTDOWN_TIMEOUT_MS.
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
    db.$client.close();
    logger.info("Process terminated");
    process.exit(error ? 1 : exitCode);
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
