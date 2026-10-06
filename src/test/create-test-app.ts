import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import mysql from "mysql2/promise";
import request from "supertest";
import { afterAll } from "vitest";

import { createApp } from "../app";
import { env, type Env } from "../config/env";
import { createDatabase, type DB } from "../db";
import { auditLogs, files, refreshTokens, users } from "../db/schema";
import type { JobName, JobPayloads, JobQueue } from "../jobs/jobs";
import { MemoryCache } from "../shared/cache/cache";
import { LocalFileStorage } from "../shared/storage/file-storage";

/**
 * Each Vitest worker gets its own database (DATABASE_URL's name + pool id),
 * so test files running in parallel never see each other's rows.
 */
const testDatabaseUrl = (() => {
  const url = new URL(env.DATABASE_URL);
  url.pathname = `${url.pathname}_${process.env.VITEST_POOL_ID ?? "0"}`;
  return url.toString();
})();

let database: Promise<DB> | undefined;

/** Creates and migrates the worker's database once per test file. */
const getDatabase = () =>
  (database ??= (async () => {
    const url = new URL(testDatabaseUrl);
    const name = url.pathname.slice(1);
    url.pathname = "/";

    const admin = await mysql.createConnection(url.toString());
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``);
    await admin.end();

    const db = createDatabase(testDatabaseUrl);
    await migrate(db, { migrationsFolder: "drizzle" });
    return db;
  })());

afterAll(async () => {
  await (await database)?.$client.end();
  database = undefined;
});

/**
 * Opens a separate pool on the test database, for tests that need to break
 * the connection without affecting the shared one.
 */
export const createTestDatabase = () => createDatabase(testDatabaseUrl);

/** Collects jobs instead of running them, so tests can assert on them. */
export class RecordingJobQueue implements JobQueue {
  readonly jobs: { name: JobName; data: JobPayloads[JobName] }[] = [];

  async add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    this.jobs.push({ name, data });
  }

  async close(): Promise<void> {}
}

/**
 * Builds an app backed by the worker's migrated test database, emptied first,
 * so every test starts from a clean, real schema. Redis is left out (the
 * in-memory fallbacks are used). Config comes from the test env
 * (vitest.config.mts) and can be overridden per test.
 */
export const createTestApp = async (config: Partial<Env> = {}) => {
  const db = await getDatabase();

  // Children before parents (foreign keys).
  for (const table of [files, refreshTokens, auditLogs, users]) {
    await db.delete(table);
  }

  const jobQueue = new RecordingJobQueue();
  const storage = new LocalFileStorage(
    mkdtempSync(path.join(tmpdir(), "boilerplate-uploads-")),
  );

  const app = createApp({
    db,
    config: { ...env, ...config },
    redis: undefined,
    cache: new MemoryCache(),
    jobQueue,
    storage,
  });

  return { app, db, jobQueue, storage };
};

export type TestApp = Awaited<ReturnType<typeof createTestApp>>["app"];

const DEFAULT_PASSWORD = "correct horse battery";

type RegisteredUser = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: string };
};

/**
 * Registers a user through the API and returns the response body data
 * (user + tokens).
 */
export const registerUser = async (
  app: TestApp,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
): Promise<RegisteredUser> => {
  const res = await request(app)
    .post("/api/v1/authentication/register")
    .send({
      name: "Ricky",
      email: "r@x.com",
      password: DEFAULT_PASSWORD,
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(
      `register failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  return res.body.data;
};

/**
 * Registers a user, promotes it to admin in the database, and logs in again
 * so the returned access token carries the admin role.
 */
export const registerAdmin = async (
  app: TestApp,
  db: DB,
  email = "admin@x.com",
): Promise<RegisteredUser> => {
  const { user } = await registerUser(app, { name: "Admin", email });
  await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));

  const res = await request(app)
    .post("/api/v1/authentication/login")
    .send({ email, password: DEFAULT_PASSWORD });

  return res.body.data;
};
