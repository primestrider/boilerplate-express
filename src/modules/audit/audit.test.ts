import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import type { DB } from "../../db";
import {
  createTestApp,
  registerAdmin,
  registerUser,
  type TestApp,
} from "../../test/create-test-app";

describe("audit log", () => {
  let app: TestApp;
  let db: DB;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });

  const list = (token: string, query = "") =>
    request(app)
      .get(`/api/v1/audit-logs${query}`)
      .set("Authorization", `Bearer ${token}`);

  it("records security events with actor, IP and request id", async () => {
    const user = await registerUser(app);
    await request(app)
      .post("/api/v1/authentication/login")
      .send({ email: "r@x.com", password: "wrong password" });
    const admin = await registerAdmin(app, db);
    await request(app)
      .patch(`/api/v1/users/${user.user.id}/role`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .set("X-Request-Id", "trace-me")
      .send({ role: "admin" });

    const res = await list(admin.accessToken, "?entityId=" + user.user.id);

    expect(res.status).toBe(200);
    expect(res.body.data.map((log: { action: string }) => log.action)).toEqual(
      expect.arrayContaining([
        "auth.registered",
        "auth.login_failed",
        "user.role_changed",
      ]),
    );

    const roleChange = res.body.data.find(
      (log: { action: string }) => log.action === "user.role_changed",
    );
    expect(roleChange).toMatchObject({
      actorId: admin.user.id,
      entityType: "user",
      entityId: user.user.id,
      metadata: { from: "user", to: "admin" },
      requestId: "trace-me",
      ip: expect.any(String),
    });
  });

  it("filters by action", async () => {
    await registerUser(app);
    const admin = await registerAdmin(app, db);

    const res = await list(admin.accessToken, "?action=auth.login");

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].actorId).toBe(admin.user.id);
  });

  it("rejects an unknown action filter", async () => {
    const admin = await registerAdmin(app, db);

    const res = await list(admin.accessToken, "?action=nope");

    expect(res.status).toBe(400);
  });

  it("is admin-only", async () => {
    const { accessToken } = await registerUser(app);

    const res = await list(accessToken);

    expect(res.status).toBe(403);
  });
});
