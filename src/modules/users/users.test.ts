import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createTestApp,
  type TestApp,
  registerAdmin,
  registerUser,
} from "../../test/create-test-app";

describe("users", () => {
  let app: TestApp;
  let userToken: string;
  let userId: string;
  let adminToken: string;
  let adminId: string;

  beforeEach(async () => {
    const testApp = await createTestApp();
    app = testApp.app;

    const user = await registerUser(app, { email: "me@x.com" });
    userToken = user.accessToken;
    userId = user.user.id;
    const admin = await registerAdmin(app, testApp.db);
    adminToken = admin.accessToken;
    adminId = admin.user.id;
  });

  const get = (url: string, token: string) =>
    request(app).get(url).set("Authorization", `Bearer ${token}`);
  const patch = (url: string, token: string, body: object) =>
    request(app).patch(url).set("Authorization", `Bearer ${token}`).send(body);
  const remove = (url: string, token: string) =>
    request(app).delete(url).set("Authorization", `Bearer ${token}`);

  it("requires authentication", async () => {
    for (const url of ["/api/v1/users", `/api/v1/users/${userId}`]) {
      const res = await request(app).get(url);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("UNAUTHORIZED");
    }
  });

  it("no longer accepts POST /api/users (use /api/authentication/register)", async () => {
    const res = await request(app)
      .post("/api/v1/users")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Ricky", email: "r@x.com" });

    expect(res.status).toBe(404);
  });

  describe("GET /api/users", () => {
    it("is forbidden for regular users", async () => {
      const res = await get("/api/v1/users", userToken);

      expect(res.status).toBe(403);
      expect(res.body.errorCode).toBe("FORBIDDEN");
    });

    it("paginates for admins with coerced query params, newest first", async () => {
      // createdAt has millisecond precision; keep the order deterministic.
      await new Promise((resolve) => setTimeout(resolve, 2));
      await registerUser(app, { name: "Newest", email: "new@x.com" });

      const res = await get("/api/v1/users?page=1&limit=2", adminToken);

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
      const res = await get("/api/v1/users", adminToken);

      expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
    });

    it("rejects an out-of-range limit", async () => {
      const res = await get("/api/v1/users?limit=500", adminToken);

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("VALIDATION_ERROR");
    });
  });

  describe("GET /api/users/:id", () => {
    it("returns the caller's own user", async () => {
      const res = await get(`/api/v1/users/${userId}`, userToken);

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
        const res = await get(`/api/v1/users/${id}`, userToken);

        expect(res.status).toBe(403);
        expect(res.body.errorCode).toBe("FORBIDDEN");
      }
    });

    it("lets admins read any user", async () => {
      const res = await get(`/api/v1/users/${userId}`, adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe("me@x.com");
    });

    it("returns 404 to admins for an unknown id", async () => {
      const res = await get(
        "/api/v1/users/00000000-0000-4000-8000-000000000000",
        adminToken,
      );

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("USER_NOT_FOUND");
    });

    it("returns 400 for a non-UUID id", async () => {
      const res = await get("/api/v1/users/not-a-uuid", adminToken);

      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/v1/users filters", () => {
    beforeEach(async () => {
      await registerUser(app, { name: "Zoe Search", email: "zoe@x.com" });
    });

    const names = (res: request.Response) =>
      res.body.data.map((u: { name: string }) => u.name);

    it("searches name and email, case-insensitively", async () => {
      const byName = await get("/api/v1/users?search=zoe", adminToken);
      const byEmail = await get("/api/v1/users?search=ME%40X", adminToken);

      expect(names(byName)).toEqual(["Zoe Search"]);
      expect(byEmail.body.data.map((u: { email: string }) => u.email)).toEqual([
        "me@x.com",
      ]);
    });

    it("treats LIKE wildcards literally", async () => {
      const res = await get("/api/v1/users?search=%25", adminToken);

      expect(res.body.data).toEqual([]);
    });

    it("filters by role and sorts", async () => {
      const admins = await get("/api/v1/users?role=admin", adminToken);
      const sorted = await get(
        "/api/v1/users?sortBy=name&sortOrder=asc",
        adminToken,
      );

      expect(names(admins)).toEqual(["Admin"]);
      expect(names(sorted)).toEqual(["Admin", "Ricky", "Zoe Search"]);
    });

    it("rejects an unknown sort field", async () => {
      const res = await get("/api/v1/users?sortBy=passwordHash", adminToken);

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/v1/users/:id", () => {
    it("lets the owner change their profile", async () => {
      const res = await patch(`/api/v1/users/${userId}`, userToken, {
        name: "Renamed",
        email: "NEW@x.com",
      });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        name: "Renamed",
        email: "new@x.com",
      });

      // The cached user was evicted, so reads see the change.
      const read = await get(`/api/v1/users/${userId}`, userToken);
      expect(read.body.data.name).toBe("Renamed");
    });

    it("forbids changing someone else", async () => {
      const res = await patch(`/api/v1/users/${adminId}`, userToken, {
        name: "Hacked",
      });

      expect(res.status).toBe(403);
    });

    it("rejects an email already in use", async () => {
      const res = await patch(`/api/v1/users/${userId}`, userToken, {
        email: "admin@x.com",
      });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe("EMAIL_ALREADY_EXISTS");
    });

    it("requires at least one field and ignores unknown ones", async () => {
      const empty = await patch(`/api/v1/users/${userId}`, userToken, {});
      const roleOnly = await patch(`/api/v1/users/${userId}`, userToken, {
        role: "admin",
      });

      expect(empty.status).toBe(400);
      expect(roleOnly.status).toBe(400);
    });
  });

  describe("PATCH /api/v1/users/:id/role", () => {
    it("lets an admin promote a user", async () => {
      const res = await patch(`/api/v1/users/${userId}/role`, adminToken, {
        role: "admin",
      });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe("admin");
    });

    it("is admin-only", async () => {
      const res = await patch(`/api/v1/users/${userId}/role`, userToken, {
        role: "admin",
      });

      expect(res.status).toBe(403);
    });

    it("does not let admins change their own role", async () => {
      const res = await patch(`/api/v1/users/${adminId}/role`, adminToken, {
        role: "user",
      });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("CANNOT_CHANGE_OWN_ROLE");
    });
  });

  describe("DELETE /api/v1/users/:id", () => {
    it("soft-deletes: the user disappears and can no longer log in", async () => {
      const res = await remove(`/api/v1/users/${userId}`, userToken);

      expect(res.status).toBe(200);
      expect((await get(`/api/v1/users/${userId}`, adminToken)).status).toBe(
        404,
      );

      const login = await request(app)
        .post("/api/v1/authentication/login")
        .send({ email: "me@x.com", password: "correct horse battery" });
      expect(login.status).toBe(401);

      const list = await get("/api/v1/users", adminToken);
      expect(list.body.meta.total).toBe(1);
    });

    it("keeps the email reserved", async () => {
      await remove(`/api/v1/users/${userId}`, userToken);

      const res = await request(app)
        .post("/api/v1/authentication/register")
        .send({ name: "Again", email: "me@x.com", password: "long password" });

      expect(res.status).toBe(409);
    });

    it("forbids deleting someone else", async () => {
      const res = await remove(`/api/v1/users/${adminId}`, userToken);

      expect(res.status).toBe(403);
    });

    it("returns 404 the second time", async () => {
      await remove(`/api/v1/users/${userId}`, adminToken);

      const res = await remove(`/api/v1/users/${userId}`, adminToken);

      expect(res.status).toBe(404);
    });
  });
});
