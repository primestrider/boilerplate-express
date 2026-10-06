/**
 * Background job worker: processes the BullMQ queue filled by the API.
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
import {
  createJobHandlers,
  QUEUE_NAME,
  runHandler,
  type JobName,
} from "./jobs/jobs";
import { NodemailerMailer } from "./shared/mail/mailer";

if (!env.REDIS_URL) {
  logger.error("REDIS_URL is required to run the worker");
  process.exit(1);
}

const handlers = createJobHandlers({ mailer: new NodemailerMailer(env) });

const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    if (!(job.name in handlers)) {
      throw new Error(`Unknown job: ${job.name}`);
    }

    await runHandler(handlers, job.name as JobName, job.data);
  },
  {
    // BullMQ workers block on Redis and need unlimited retries per command.
    connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    concurrency: 5,
  },
);

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
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
