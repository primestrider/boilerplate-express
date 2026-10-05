import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";

import { createApp } from "../app";
import { env, type Env } from "../config/env";
import { createDatabase, type DB } from "../db";
import { users } from "../db/schema";

/**
 * Builds an app backed by a fresh in-memory database with all migrations
 * applied, so every test starts from a clean, real schema. Config comes from
 * the test env (vitest.config.mts) and can be overridden per test.
 */
export const createTestApp = (config: Partial<Env> = {}) => {
  const db = createDatabase(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });

  return { app: createApp({ db, config: { ...env, ...config } }), db };
};

type TestApp = ReturnType<typeof createTestApp>["app"];

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
    .post("/api/authentication/register")
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
    .post("/api/authentication/login")
    .send({ email, password: DEFAULT_PASSWORD });

  return res.body.data;
};
