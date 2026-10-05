import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createTestApp,
  registerAdmin,
  registerUser,
} from "../../test/create-test-app";

describe("users", () => {
  let app: ReturnType<typeof createTestApp>["app"];
  let userToken: string;
  let userId: string;
  let adminToken: string;

  beforeEach(async () => {
    const testApp = createTestApp();
    app = testApp.app;

    const user = await registerUser(app, { email: "me@x.com" });
    userToken = user.accessToken;
    userId = user.user.id;
    adminToken = (await registerAdmin(app, testApp.db)).accessToken;
  });

  const get = (url: string, token: string) =>
    request(app).get(url).set("Authorization", `Bearer ${token}`);

  it("requires authentication", async () => {
    for (const url of ["/api/users", `/api/users/${userId}`]) {
      const res = await request(app).get(url);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("UNAUTHORIZED");
    }
  });

  it("no longer accepts POST /api/users (use /api/authentication/register)", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Ricky", email: "r@x.com" });

    expect(res.status).toBe(404);
  });

  describe("GET /api/users", () => {
    it("is forbidden for regular users", async () => {
      const res = await get("/api/users", userToken);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe("FORBIDDEN");
    });

    it("paginates for admins with coerced query params, newest first", async () => {
      // createdAt has millisecond precision; keep the order deterministic.
      await new Promise((resolve) => setTimeout(resolve, 2));
      await registerUser(app, { name: "Newest", email: "new@x.com" });

      const res = await get("/api/users?page=1&limit=2", adminToken);

      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(res.body.data.map((u: { name: string }) => u.name)).toEqual([
        "Newest",
        "Admin",
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it("applies query defaults", async () => {
      const res = await get("/api/users", adminToken);

      expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
    });

    it("rejects an out-of-range limit", async () => {
      const res = await get("/api/users?limit=500", adminToken);

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/users/:id", () => {
    it("returns the caller's own user", async () => {
      const res = await get(`/api/users/${userId}`, userToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ email: "me@x.com", role: "user" });
      expect(res.body.data).not.toHaveProperty("passwordHash");
    });

    it("forbids reading another user, whether or not it exists", async () => {
      const other = await registerUser(app, { email: "other@x.com" });

      for (const id of [
        other.user.id,
        "00000000-0000-4000-8000-000000000000",
      ]) {
        const res = await get(`/api/users/${id}`, userToken);

        expect(res.status).toBe(403);
        expect(res.body.errorCode).toBe("FORBIDDEN");
      }
    });

    it("lets admins read any user", async () => {
      const res = await get(`/api/users/${userId}`, adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe("me@x.com");
    });

    it("returns 404 to admins for an unknown id", async () => {
      const res = await get(
        "/api/users/00000000-0000-4000-8000-000000000000",
        adminToken,
      );

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("USER_NOT_FOUND");
    });

    it("returns 400 for a non-UUID id", async () => {
      const res = await get("/api/users/not-a-uuid", adminToken);

      expect(res.status).toBe(400);
    });
  });
});
