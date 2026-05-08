import app from "./app";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { disconnectPrisma } from "./libs/prisma";

const server = app.listen(env.PORT, () => {
  logger.info(`Server running on http://localhost:${env.PORT}`);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
  process.exit(1);
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received. Shutting down gracefully...`);

  server.close(async () => {
    await disconnectPrisma();
    logger.info("Process terminated");
    process.exit(0);
  });
};

process.on("unhandledRejection", (error) => {
  logger.error("Unhandled rejection", error);
  server.close(async () => {
    await disconnectPrisma();
    process.exit(1);
  });
});

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
