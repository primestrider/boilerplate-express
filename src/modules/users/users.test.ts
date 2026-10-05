import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestApp, registerUser } from "../../test/create-test-app";

describe("users", () => {
  let app: ReturnType<typeof createTestApp>["app"];
  let token: string;
  let currentUserId: string;

  beforeEach(async () => {
    ({ app } = createTestApp());
    const registered = await registerUser(app, { email: "me@x.com" });
    token = registered.accessToken;
    currentUserId = registered.user.id;
  });

  const get = (url: string) =>
    request(app).get(url).set("Authorization", `Bearer ${token}`);

  it("requires authentication", async () => {
    for (const url of ["/api/users", `/api/users/${currentUserId}`]) {
      const res = await request(app).get(url);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("UNAUTHORIZED");
    }
  });

  it("no longer accepts POST /api/users (use /api/authentication/register)", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Ricky", email: "r@x.com" });

    expect(res.status).toBe(404);
  });

  describe("GET /api/users", () => {
    it("paginates with coerced query params, newest first", async () => {
      for (const n of [1, 2]) {
        // createdAt has millisecond precision; keep the order deterministic.
        await new Promise((resolve) => setTimeout(resolve, 2));
        await registerUser(app, { name: `User ${n}`, email: `u${n}@x.com` });
      }

      const res = await get("/api/users?page=1&limit=2");

      expect(res.status).toBe(200);
      expect(res.body.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(res.body.data.map((u: { name: string }) => u.name)).toEqual([
        "User 2",
        "User 1",
      ]);
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it("applies query defaults", async () => {
      const res = await get("/api/users");

      expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
    });

    it("rejects an out-of-range limit", async () => {
      const res = await get("/api/users?limit=500");

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/users/:id", () => {
    it("returns the user", async () => {
      const res = await get(`/api/users/${currentUserId}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe("me@x.com");
      expect(res.body.data).not.toHaveProperty("passwordHash");
    });

    it("returns 404 for an unknown id", async () => {
      const res = await get("/api/users/00000000-0000-4000-8000-000000000000");

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("USER_NOT_FOUND");
    });

    it("returns 400 for a non-UUID id", async () => {
      const res = await get("/api/users/not-a-uuid");

      expect(res.status).toBe(400);
    });
  });
});
