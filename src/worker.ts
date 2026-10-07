/**
 * Background job worker: processes the BullMQ queue filled by the API and
 * registers the recurring jobs (JOB_SCHEDULES).
 *
 *   npm run worker            (development)
 *   node dist/worker.js       (after build)
 *
 * Requires REDIS_URL. Run as many workers as the load needs.
 */
import { Worker } from "bullmq";
import Redis from "ioredis";

import { env } from "./config/env";
import { logger } from "./config/logger";
import { createDatabase } from "./db";
import {
  BullJobQueue,
  createJobHandlers,
  JOB_SCHEDULES,
  QUEUE_NAME,
  runHandler,
  type JobName,
} from "./jobs/jobs";
import { DrizzleRefreshTokenRepository } from "./modules/authentication/refresh-token.repository";
import { NodemailerMailer } from "./shared/mail/mailer";

if (!env.REDIS_URL) {
  logger.error("REDIS_URL is required to run the worker");
  process.exit(1);
}

// BullMQ workers block on Redis and need unlimited retries per command.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const db = createDatabase(env.DATABASE_URL);

const handlers = createJobHandlers({
  mailer: new NodemailerMailer(env),
  refreshTokenRepository: new DrizzleRefreshTokenRepository(db),
});

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (!(job.name in handlers)) {
      throw new Error(`Unknown job: ${job.name}`);
    }

    await runHandler(handlers, job.name as JobName, job.data);
  },
  { connection, concurrency: 5 },
);

// Waits for Redis, so a worker started before Redis is up still registers the
// schedules once it connects.
const jobQueue = new BullJobQueue(connection);
jobQueue
  .syncSchedules(JOB_SCHEDULES)
  .then(() => {
    logger.info("Job schedules registered", {
      schedules: JOB_SCHEDULES.map(({ name, pattern }) => ({ name, pattern })),
    });
  })
  .catch((error: unknown) => {
    // Not fatal: schedules registered by an earlier start keep running.
    logger.error("Failed to register job schedules", {
      error: error instanceof Error ? error.message : String(error),
    });
  });

worker.on("completed", (job) => {
  logger.info("Job completed", { job: job.name, jobId: job.id });
});

worker.on("failed", (job, error) => {
  logger.error("Job failed", {
    job: job?.name,
    jobId: job?.id,
    attempt: job?.attemptsMade,
    error: error.message,
  });
});

logger.info("Worker started", { queue: QUEUE_NAME });

const shutdown = async (signal: string) => {
  logger.info(`${signal} received. Finishing active jobs...`);
  // Waits for running jobs; unfinished ones are retried by another worker.
  await worker.close();
  await jobQueue.close();
  await Promise.all([db.$client.end(), connection.quit()]);
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
