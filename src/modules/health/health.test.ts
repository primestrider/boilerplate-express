import request from "supertest";
import { describe, expect, it } from "vitest";

import { createTestApp } from "../../test/create-test-app";

describe("health", () => {
  it("GET /api/health/live reports the process is up", async () => {
    const { app } = createTestApp();

    const res = await request(app).get("/api/health/live");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "OK" });
  });

  it("GET /api/health/ready checks the database", async () => {
    const { app } = createTestApp();

    const res = await request(app).get("/api/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      status: "OK",
      checks: { database: "up" },
    });
  });

  it("GET /api/health/ready returns 503 when the database is down", async () => {
    const { app, db } = createTestApp();
    db.$client.close();

    const res = await request(app).get("/api/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.errorCode).toBe("DATABASE_UNAVAILABLE");
  });
});
