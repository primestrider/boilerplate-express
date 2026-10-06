import { Queue } from "bullmq";
import type Redis from "ioredis";

import { logger } from "../config/logger";
import type { Mailer, MailMessage } from "../shared/mail/mailer";

/**
 * Every background job and its payload. Payloads go through Redis as JSON,
 * so keep them small and serializable (ids, not entities).
 */
export type JobPayloads = {
  "send-email": MailMessage;
};

export type JobName = keyof JobPayloads;

export type JobHandlers = {
  [N in JobName]: (data: JobPayloads[N]) => Promise<void>;
};

export interface JobQueue {
  /** Schedules a job; resolves once it is queued, not when it has run. */
  add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void>;
  close(): Promise<void>;
}

export const QUEUE_NAME = "jobs";

/** What each job does. Used by the worker and by the inline queue. */
export const createJobHandlers = ({
  mailer,
}: {
  mailer: Mailer;
}): JobHandlers => ({
  "send-email": (message) => mailer.send(message),
});

export const runHandler = <N extends JobName>(
  handlers: JobHandlers,
  name: N,
  data: JobPayloads[N],
) => (handlers[name] as (data: JobPayloads[N]) => Promise<void>)(data);

/**
 * BullMQ queue: jobs are persisted in Redis, retried with backoff, and run by
 * the separate worker process (src/worker.ts).
 */
export class BullJobQueue implements JobQueue {
  private readonly queue: Queue;

  constructor(private readonly connection: Redis) {
    this.queue = new Queue(QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }

  async add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    // BullMQ waits for the connection without a timeout; fail fast instead
    // of stalling the request while Redis is down.
    if (this.connection.status !== "ready") {
      throw new Error(`Redis is not ready (${this.connection.status})`);
    }

    await this.queue.add(name, data);
  }

  /** Closes the queue; the shared connection is closed by its owner. */
  close(): Promise<void> {
    return this.queue.close();
  }
}

/**
 * Runs jobs in this process right after the request, without persistence or
 * retries. Used when REDIS_URL is not set (local development).
 */
export class InlineJobQueue implements JobQueue {
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly handlers: JobHandlers) {}

  async add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    // Not awaited: like a real queue, the caller does not wait for the job.
    const job = runHandler(this.handlers, name, data)
      .catch((error: unknown) => {
        logger.error("Job failed", {
          job: name,
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => this.running.delete(job));

    this.running.add(job);
  }

  /** Waits for jobs already started, so shutdown does not cut them off. */
  async close(): Promise<void> {
    await Promise.all(this.running);
  }
}
