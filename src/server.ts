import app from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";

const PORT = env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
});

/**
 * Graceful shutdown & error handling
 */
process.on("uncaughtException", (err) => {
  logger.error("UNCAUGHT EXCEPTION 💥", err);
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  logger.error("UNHANDLED REJECTION 💥", err);
  server.close(() => process.exit(1));
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM RECEIVED. Shutting down gracefully...");
  server.close(() => {
    logger.info("Process terminated");
  });
});
