import request from "supertest";
import { describe, expect, it } from "vitest";

import { userResponseSchema } from "../modules/users/user.mapper";
import { createTestApp, registerUser } from "../test/create-test-app";

describe("API docs", () => {
  it("serves an OpenAPI 3.1 document describing every route", async () => {
    const { app } = createTestApp();

    const res = await request(app).get("/api/docs/openapi.json");

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(Object.keys(res.body.paths).sort()).toEqual([
      "/authentication/login",
      "/authentication/logout",
      "/authentication/profile",
      "/authentication/refresh",
      "/authentication/register",
      "/health/live",
      "/health/ready",
      "/users",
      "/users/{id}",
    ]);
  });

  it("serves Swagger UI without inline scripts (works with helmet's CSP)", async () => {
    const { app } = createTestApp();

    const res = await request(app).get("/api/docs/");

    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
    expect(res.text).not.toMatch(/<script>(?!\s*<\/script>)/);
  });

  it("is not served in production", async () => {
    const { app } = createTestApp({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.example.com",
    });

    const res = await request(app).get("/api/docs/openapi.json");

    expect(res.status).toBe(404);
  });

  it("matches what the API actually returns", async () => {
    const { app } = createTestApp();

    const { user } = await registerUser(app);

    // The documented User schema is the one the mapper is typed against;
    // this guards the runtime output too (e.g. dates as ISO strings).
    expect(userResponseSchema.parse(user)).toEqual(user);
  });
});
