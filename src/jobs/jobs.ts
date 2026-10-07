import { Queue } from "bullmq";
import type Redis from "ioredis";

import { logger } from "../config/logger";
import type { RefreshTokenRepository } from "../modules/authentication/refresh-token.repository";
import type { Mailer, MailMessage } from "../shared/mail/mailer";

/**
 * Every background job and its payload. Payloads go through Redis as JSON,
 * so keep them small and serializable (ids, not entities).
 */
export type JobPayloads = {
  "send-email": MailMessage;
  "cleanup-expired-refresh-tokens": Record<string, never>;
};

export type JobName = keyof JobPayloads;

type JobSchedule = {
  [N in JobName]: {
    name: N;
    /** Cron expression, evaluated in UTC: "min hour day month weekday". */
    pattern: string;
    data: JobPayloads[N];
  };
}[JobName];

/**
 * Recurring jobs. The worker registers them in Redis at startup; BullMQ then
 * adds one job per tick, however many workers or API instances run, and any
 * worker picks it up with the usual retries.
 */
export const JOB_SCHEDULES: JobSchedule[] = [
  {
    name: "cleanup-expired-refresh-tokens",
    pattern: "0 3 * * *", // daily at 03:00 UTC
    data: {},
  },
];

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
  refreshTokenRepository,
}: {
  mailer: Mailer;
  refreshTokenRepository: RefreshTokenRepository;
}): JobHandlers => ({
  "send-email": (message) => mailer.send(message),
  "cleanup-expired-refresh-tokens": async () => {
    const deleted = await refreshTokenRepository.deleteExpired(new Date());
    logger.info("Expired refresh tokens deleted", { deleted });
  },
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

  /**
   * Makes the schedules in Redis match `schedules`: upserts each one (safe
   * when several workers start at once) and removes those no longer listed,
   * which would otherwise keep firing after being renamed or deleted.
   * Scheduled jobs get this queue's retry and retention options.
   */
  async syncSchedules(schedules: JobSchedule[]): Promise<void> {
    for (const schedule of schedules) {
      await this.queue.upsertJobScheduler(
        schedule.name,
        { pattern: schedule.pattern, tz: "UTC" },
        { name: schedule.name, data: schedule.data },
      );
    }

    const wanted = new Set<string>(schedules.map((schedule) => schedule.name));
    for (const existing of await this.queue.getJobSchedulers()) {
      if (!wanted.has(existing.key)) {
        await this.queue.removeJobScheduler(existing.key);
      }
    }
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
