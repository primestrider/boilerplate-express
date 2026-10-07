import { randomBytes, randomUUID } from "node:crypto";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { DB } from "../db";
import { refreshTokens } from "../db/schema";
import { DrizzleRefreshTokenRepository } from "../modules/authentication/refresh-token.repository";
import {
  createTestApp,
  registerUser,
  type TestApp,
} from "../test/create-test-app";
import {
  BullJobQueue,
  createJobHandlers,
  JOB_SCHEDULES,
  QUEUE_NAME,
} from "./jobs";

describe("cleanup-expired-refresh-tokens", () => {
  let app: TestApp;
  let db: DB;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });

  const cleanup = () =>
    createJobHandlers({
      mailer: { send: async () => {} },
      refreshTokenRepository: new DrizzleRefreshTokenRepository(db),
    })["cleanup-expired-refresh-tokens"]({});

  const insertTokens = (
    userId: string,
    count: number,
    {
      expiresAt,
      revokedAt = null,
    }: { expiresAt: Date; revokedAt?: Date | null },
  ) =>
    db.insert(refreshTokens).values(
      Array.from({ length: count }, () => ({
        userId,
        tokenHash: randomBytes(32).toString("hex"),
        familyId: randomUUID(),
        expiresAt,
        revokedAt,
      })),
    );

  it("deletes expired tokens and keeps the others", async () => {
    const { user } = await registerUser(app); // one active token
    const past = new Date(Date.now() - 60_000);
    const future = new Date(Date.now() + 60_000);
    await insertTokens(user.id, 1, { expiresAt: past });
    await insertTokens(user.id, 1, { expiresAt: past, revokedAt: past });
    // Revoked but not expired: still needed to detect a replayed token.
    await insertTokens(user.id, 1, { expiresAt: future, revokedAt: past });

    await cleanup();

    const rows = await db.select().from(refreshTokens);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.expiresAt > new Date())).toBe(true);
  });

  it("deletes in batches until none are left", async () => {
    const { user } = await registerUser(app);
    await insertTokens(user.id, 2500, {
      expiresAt: new Date(Date.now() - 60_000),
    });

    const deleted = await new DrizzleRefreshTokenRepository(db).deleteExpired(
      new Date(),
    );

    expect(deleted).toBe(2500);
    expect(await db.select().from(refreshTokens)).toHaveLength(1);
  });
});

const redisUrl = process.env.TEST_REDIS_URL;

describe.skipIf(!redisUrl)("BullJobQueue.syncSchedules", () => {
  const connection = new Redis(redisUrl ?? "", { maxRetriesPerRequest: null });
  const jobQueue = new BullJobQueue(connection);
  const inspect = new Queue(QUEUE_NAME, { connection });

  afterAll(async () => {
    await jobQueue.syncSchedules([]);
    await inspect.close();
    await jobQueue.close();
    await connection.quit();
  });

  it("registers every schedule and removes stale ones", async () => {
    await inspect.upsertJobScheduler("renamed-job", { every: 60_000 });

    await jobQueue.syncSchedules(JOB_SCHEDULES);
    await jobQueue.syncSchedules(JOB_SCHEDULES); // a second worker starting

    const schedulers = await inspect.getJobSchedulers();
    expect(schedulers.map((s) => s.key).sort()).toEqual(
      JOB_SCHEDULES.map((s) => s.name).sort(),
    );
    expect(schedulers[0]).toMatchObject({
      pattern: JOB_SCHEDULES[0]?.pattern,
      tz: "UTC",
    });
  });
});
