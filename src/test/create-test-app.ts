import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import request from "supertest";

import { createApp } from "../app";
import { createDatabase } from "../db";

/**
 * Builds an app backed by a fresh in-memory database with all migrations
 * applied, so every test starts from a clean, real schema.
 */
export const createTestApp = () => {
  const db = createDatabase(":memory:");
  migrate(db, { migrationsFolder: "drizzle" });

  return { app: createApp({ db }), db };
};

type TestApp = ReturnType<typeof createTestApp>["app"];

/**
 * Registers a user through the API and returns the response body data
 * (user + access token).
 */
export const registerUser = async (
  app: TestApp,
  overrides: Partial<{ name: string; email: string; password: string }> = {},
) => {
  const res = await request(app)
    .post("/api/authentication/register")
    .send({
      name: "Ricky",
      email: "r@x.com",
      password: "correct horse battery",
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(
      `register failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  return res.body.data as {
    accessToken: string;
    user: { id: string; name: string; email: string };
  };
};
