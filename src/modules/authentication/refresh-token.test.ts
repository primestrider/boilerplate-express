import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import type { DB } from "../../db";
import { refreshTokens, users } from "../../db/schema";
import {
  createTestApp,
  registerUser,
  type TestApp,
} from "../../test/create-test-app";

describe("refresh tokens", () => {
  let app: TestApp;
  let db: DB;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });

  const refresh = (refreshToken: string) =>
    request(app).post("/api/v1/authentication/refresh").send({ refreshToken });

  const logout = (refreshToken: string) =>
    request(app).post("/api/v1/authentication/logout").send({ refreshToken });

  const profile = (accessToken: string) =>
    request(app)
      .get("/api/v1/authentication/profile")
      .set("Authorization", `Bearer ${accessToken}`);

  it("is returned on register and stored only as a hash", async () => {
    const { refreshToken } = await registerUser(app);

    const rows = await db.select().from(refreshTokens);

    expect(refreshToken).toEqual(expect.any(String));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.tokenHash).not.toBe(refreshToken);
  });

  it("rotates: returns a working token pair and invalidates the old token", async () => {
    const registered = await registerUser(app);

    const res = await refresh(registered.refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      tokenType: "Bearer",
      refreshExpiresIn: 2592000,
      user: { email: "r@x.com" },
    });
    expect(res.body.data.refreshToken).not.toBe(registered.refreshToken);
    expect((await profile(res.body.data.accessToken)).status).toBe(200);
  });

  it("revokes the whole session when a used token is replayed", async () => {
    const { refreshToken: first } = await registerUser(app);
    const second = (await refresh(first)).body.data.refreshToken;

    const replay = await refresh(first);
    const afterReplay = await refresh(second);

    expect(replay.status).toBe(401);
    expect(replay.body.errorCode).toBe("INVALID_REFRESH_TOKEN");
    // The legitimate latest token dies too: the session is compromised.
    expect(afterReplay.status).toBe(401);
  });

  it("keeps other sessions alive when one session is revoked", async () => {
    const { refreshToken: sessionA } = await registerUser(app);
    const login = await request(app)
      .post("/api/v1/authentication/login")
      .send({ email: "r@x.com", password: "correct horse battery" });
    const sessionB = login.body.data.refreshToken;

    await logout(sessionA);

    expect((await refresh(sessionA)).status).toBe(401);
    expect((await refresh(sessionB)).status).toBe(200);
  });

  it("rejects an expired token", async () => {
    const { refreshToken } = await registerUser(app);
    await db.update(refreshTokens).set({ expiresAt: new Date(0) });

    const res = await refresh(refreshToken);

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe("INVALID_REFRESH_TOKEN");
  });

  it("rejects an unknown token", async () => {
    const res = await refresh("not-a-real-token");

    expect(res.status).toBe(401);
    expect(res.body.errorCode).toBe("INVALID_REFRESH_TOKEN");
  });

  it("logout answers the same for unknown tokens", async () => {
    const res = await logout("not-a-real-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      statusCode: 200,
      message: "Logged out successfully",
    });
  });

  it("dies with its user", async () => {
    const { refreshToken } = await registerUser(app);
    await db.delete(users);

    expect((await refresh(refreshToken)).status).toBe(401);
  });

  it("carries a role change into the next access token", async () => {
    const { refreshToken } = await registerUser(app);
    await db.update(users).set({ role: "admin" });

    const res = await refresh(refreshToken);
    const list = await request(app)
      .get("/api/v1/users")
      .set("Authorization", `Bearer ${res.body.data.accessToken}`);

    expect(res.body.data.user.role).toBe("admin");
    expect(list.status).toBe(200);
  });
});
