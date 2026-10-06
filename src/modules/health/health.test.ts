import Redis from "ioredis";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../../app";
import { env } from "../../config/env";
import { MemoryCache } from "../../shared/cache/cache";
import { LocalFileStorage } from "../../shared/storage/file-storage";
import {
  createTestApp,
  createTestDatabase,
  RecordingJobQueue,
} from "../../test/create-test-app";

describe("health", () => {
  it("GET /api/health/live reports the process is up", async () => {
    const { app } = await createTestApp();

    const res = await request(app).get("/api/health/live");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "OK" });
  });

  it("GET /api/health/ready checks the database", async () => {
    const { app } = await createTestApp();

    const res = await request(app).get("/api/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "OK",
      checks: { database: "up" },
    });
    expect(res.body.data.checks).not.toHaveProperty("redis");
  });

  it("GET /api/health/ready returns 503 naming the dependency that is down", async () => {
    const db = createTestDatabase();
    await db.$client.end();
    // Nothing listens on port 1, so the Redis check fails too.
    const redis = new Redis("redis://127.0.0.1:1", {
      lazyConnect: true,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
    });
    redis.on("error", () => {});

    const app = createApp({
      db,
      config: env,
      redis,
      cache: new MemoryCache(),
      jobQueue: new RecordingJobQueue(),
      storage: new LocalFileStorage("unused"),
    });

    const res = await request(app).get("/api/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.errorCode).toBe("DEPENDENCY_UNAVAILABLE");
    expect(res.body.details).toEqual({ database: "down", redis: "down" });
    redis.disconnect();
  });
});
