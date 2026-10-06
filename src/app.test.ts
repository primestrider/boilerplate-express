import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";

import {
  createTestApp,
  type TestApp,
  registerAdmin,
  registerUser,
} from "./test/create-test-app";

let app: TestApp;

beforeAll(async () => {
  ({ app } = await createTestApp());
});

describe("app", () => {
  it("returns 404 with an error code for unknown routes", async () => {
    const res = await request(app).get("/api/nope?token=secret");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      statusCode: 404,
      message: "Route GET /api/nope not found",
      errorCode: "ROUTE_NOT_FOUND",
    });
  });

  it("mirrors the HTTP status as statusCode in every response body", async () => {
    const { app, db } = await createTestApp();
    const { accessToken } = await registerUser(app);
    const admin = await registerAdmin(app, db);
    const auth = { Authorization: `Bearer ${admin.accessToken}` };
    const userAuth = { Authorization: `Bearer ${accessToken}` };

    const responses = await Promise.all([
      request(app).get("/api/health/live"), // 200 success
      request(app).get("/api/v1/users").set(auth), // 200 paginated
      request(app)
        .post("/api/v1/authentication/register")
        .send({ name: "Anna", email: "a@x.com", password: "long password" }), // 201
      request(app)
        .post("/api/v1/authentication/register")
        .send({ name: "Dup", email: "r@x.com", password: "long password" }), // 409
      request(app).get("/api/v1/users?limit=0").set(auth), // 400 validation
      request(app)
        .post("/api/v1/authentication/login")
        .set("Content-Type", "application/json")
        .send("{bad"), // 400 malformed JSON
      request(app).get("/api/v1/users"), // 401
      request(app).get("/api/v1/users").set(userAuth), // 403
      request(app).get("/api/nope"), // 404
    ]);

    expect(responses.map((res) => res.status)).toEqual([
      200, 200, 201, 409, 400, 400, 401, 403, 404,
    ]);
    for (const res of responses) {
      expect(res.body.statusCode).toBe(res.status);
    }
  });

  it("sets security headers", async () => {
    const res = await request(app).get("/api/health/live");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  describe("request id", () => {
    it("generates one when missing", async () => {
      const res = await request(app).get("/api/health/live");

      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("reuses a safe incoming value", async () => {
      const res = await request(app)
        .get("/api/health/live")
        .set("X-Request-Id", "abc-123");

      expect(res.headers["x-request-id"]).toBe("abc-123");
    });

    it("replaces an unsafe incoming value", async () => {
      const res = await request(app)
        .get("/api/health/live")
        .set("X-Request-Id", "bad id<script>");

      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe("body parsing", () => {
    it("answers malformed JSON with 400", async () => {
      const res = await request(app)
        .post("/api/v1/authentication/login")
        .set("Content-Type", "application/json")
        .send("{bad");

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("BAD_REQUEST");
    });

    it("answers bodies over 100kb with 413", async () => {
      const res = await request(app)
        .post("/api/v1/authentication/login")
        .send({ email: "a@b.com", password: "a".repeat(200_000) });

      expect(res.status).toBe(413);
      expect(res.body.errorCode).toBe("REQUEST_ENTITY_TOO_LARGE");
    });
  });
});

describe("compression and caching", () => {
  it("compresses large responses when the client accepts gzip", async () => {
    const res = await request(app)
      .get("/api/docs/openapi.json")
      .set("Accept-Encoding", "gzip");

    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("answers a matching If-None-Match with 304", async () => {
    const first = await request(app).get("/api/docs/openapi.json");

    const second = await request(app)
      .get("/api/docs/openapi.json")
      .set("If-None-Match", first.headers.etag as string);

    expect(first.headers.etag).toBeDefined();
    expect(second.status).toBe(304);
  });
});
