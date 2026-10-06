import request from "supertest";
import { describe, expect, it } from "vitest";

import { userResponseSchema } from "../modules/users/user.mapper";
import { createTestApp, registerUser } from "../test/create-test-app";

describe("API docs", () => {
  it("serves an OpenAPI 3.1 document describing every route", async () => {
    const { app } = await createTestApp();

    const res = await request(app).get("/api/docs/openapi.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths).sort()).toEqual([
      "/health/live",
      "/health/ready",
      "/v1/audit-logs",
      "/v1/authentication/change-password",
      "/v1/authentication/login",
      "/v1/authentication/logout",
      "/v1/authentication/profile",
      "/v1/authentication/refresh",
      "/v1/authentication/register",
      "/v1/files",
      "/v1/files/{id}",
      "/v1/files/{id}/content",
      "/v1/users",
      "/v1/users/{id}",
      "/v1/users/{id}/role",
    ]);
  });

  it("serves Swagger UI without inline scripts (works with helmet's CSP)", async () => {
    const { app } = await createTestApp();

    const res = await request(app).get("/api/docs/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
    expect(res.text).not.toMatch(/<script>(?!\s*<\/script>)/);
  });

  it("is not served in production", async () => {
    const { app } = await createTestApp({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.example.com",
    });

    const res = await request(app).get("/api/docs/openapi.json");

    expect(res.status).toBe(404);
  });

  it("matches what the API actually returns", async () => {
    const { app } = await createTestApp();

    const { user } = await registerUser(app);

    // The documented User schema is the one the mapper is typed against;
    // this guards the runtime output too (e.g. dates as ISO strings).
    expect(userResponseSchema.parse(user)).toEqual(user);
  });
});
