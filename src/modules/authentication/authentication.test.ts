import argon2 from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import type { DB } from "../../db";
import { users } from "../../db/schema";
import {
  createTestApp,
  type RecordingJobQueue,
  registerUser,
  type TestApp,
} from "../../test/create-test-app";

const SECRET = process.env.JWT_SECRET as string;

describe("authentication", () => {
  let app: TestApp;
  let db: DB;

  beforeEach(async () => {
    ({ app, db } = await createTestApp());
  });

  const login = (email: string, password: string) =>
    request(app).post("/api/v1/authentication/login").send({ email, password });

  describe("POST /api/authentication/register", () => {
    it("creates a user, returns a token, and never exposes the hash", async () => {
      const res = await request(app)
        .post("/api/v1/authentication/register")
        .send({
          name: " Ricky ",
          email: "R@X.com",
          password: "correct horse battery",
        });

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({
        tokenType: "Bearer",
        expiresIn: 900,
        user: { name: "Ricky", email: "r@x.com" },
      });
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    });

    it("stores an argon2id hash, not the password", async () => {
      await registerUser(app);

      const [row] = await db.select().from(users);

      expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    });

    it("rejects a duplicate email regardless of case", async () => {
      await registerUser(app, { email: "r@x.com" });

      const res = await request(app)
        .post("/api/v1/authentication/register")
        .send({
          name: "Other",
          email: "R@X.COM",
          password: "another password",
        });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe("EMAIL_ALREADY_EXISTS");
    });

    it("rejects a short password", async () => {
      const res = await request(app)
        .post("/api/v1/authentication/register")
        .send({ name: "Ricky", email: "r@x.com", password: "short" });

      expect(res.status).toBe(400);
      expect(res.body.details).toEqual([
        expect.objectContaining({ path: "password" }),
      ]);
    });
  });

  describe("POST /api/authentication/login", () => {
    beforeEach(async () => {
      await registerUser(app);
    });

    it("returns a token for valid credentials", async () => {
      const res = await login("R@X.com", "correct horse battery");

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe("r@x.com");

      const payload = jwt.verify(res.body.data.accessToken, SECRET);
      expect(payload).toMatchObject({ sub: res.body.data.user.id });
    });

    it("gives the same answer for a wrong password and an unknown email", async () => {
      const wrongPassword = await login("r@x.com", "wrong password");
      const unknownEmail = await login("nobody@x.com", "wrong password");

      for (const res of [wrongPassword, unknownEmail]) {
        expect(res.status).toBe(401);
        expect(res.body).toEqual({
          statusCode: 401,
          message: "Invalid email or password",
          errorCode: "INVALID_CREDENTIALS",
        });
      }
    });

    it("upgrades a hash made with weaker parameters on login", async () => {
      const weakHash = await argon2.hash("correct horse battery", {
        type: argon2.argon2id,
        memoryCost: 8 * 1024,
        timeCost: 1,
        parallelism: 1,
      });
      await db.update(users).set({ passwordHash: weakHash });

      const res = await login("r@x.com", "correct horse battery");

      const [row] = await db.select().from(users);
      expect(res.status).toBe(200);
      expect(row?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    });

    it("rate-limits failed attempts", async () => {
      for (let i = 0; i < 10; i++) {
        await login("r@x.com", "wrong password");
      }

      const res = await login("r@x.com", "correct horse battery");

      expect(res.status).toBe(429);
      expect(res.body.errorCode).toBe("TOO_MANY_REQUESTS");
    });
  });

  describe("GET /api/authentication/profile", () => {
    it("returns the current user", async () => {
      const { accessToken } = await registerUser(app);

      const res = await request(app)
        .get("/api/v1/authentication/profile")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe("r@x.com");
      expect(res.headers["www-authenticate"]).toBeUndefined();
    });

    it("requires a token", async () => {
      const res = await request(app).get("/api/v1/authentication/profile");

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("UNAUTHORIZED");
      expect(res.headers["www-authenticate"]).toBe("Bearer");
    });

    it("rejects a token signed with another secret", async () => {
      const forged = jwt.sign(
        { sub: "x" },
        "some-other-secret-of-32-characters!!",
      );

      const res = await request(app)
        .get("/api/v1/authentication/profile")
        .set("Authorization", `Bearer ${forged}`);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("INVALID_TOKEN");
    });

    it("rejects an unsigned (alg: none) token", async () => {
      const unsigned = jwt.sign({ sub: "x" }, "", { algorithm: "none" });

      const res = await request(app)
        .get("/api/v1/authentication/profile")
        .set("Authorization", `Bearer ${unsigned}`);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("INVALID_TOKEN");
    });

    it("rejects an expired token", async () => {
      const expired = jwt.sign(
        { sub: "x", exp: Math.floor(Date.now() / 1000) - 10 },
        SECRET,
      );

      const res = await request(app)
        .get("/api/v1/authentication/profile")
        .set("Authorization", `Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("TOKEN_EXPIRED");
    });

    it("returns 404 when the token's user no longer exists", async () => {
      const { accessToken } = await registerUser(app);
      await db.delete(users);

      const res = await request(app)
        .get("/api/v1/authentication/profile")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("USER_NOT_FOUND");
    });
  });
});

describe("POST /api/v1/authentication/change-password", () => {
  let app: TestApp;
  let jobQueue: RecordingJobQueue;

  beforeEach(async () => {
    ({ app, jobQueue } = await createTestApp());
  });

  const changePassword = (token: string, body: object) =>
    request(app)
      .post("/api/v1/authentication/change-password")
      .set("Authorization", `Bearer ${token}`)
      .send(body);

  it("changes the password, ends every session and emails the user", async () => {
    const { accessToken, refreshToken } = await registerUser(app);

    const res = await changePassword(accessToken, {
      currentPassword: "correct horse battery",
      newPassword: "a brand new password",
    });

    expect(res.status).toBe(200);

    const refresh = await request(app)
      .post("/api/v1/authentication/refresh")
      .send({ refreshToken });
    expect(refresh.status).toBe(401);

    const oldLogin = await request(app)
      .post("/api/v1/authentication/login")
      .send({ email: "r@x.com", password: "correct horse battery" });
    const newLogin = await request(app)
      .post("/api/v1/authentication/login")
      .send({ email: "r@x.com", password: "a brand new password" });
    expect(oldLogin.status).toBe(401);
    expect(newLogin.status).toBe(200);

    expect(jobQueue.jobs[jobQueue.jobs.length - 1]).toMatchObject({
      name: "send-email",
      data: { to: "r@x.com", subject: "Your password was changed" },
    });
  });

  it("rejects a wrong current password", async () => {
    const { accessToken } = await registerUser(app);

    const res = await changePassword(accessToken, {
      currentPassword: "not my password",
      newPassword: "a brand new password",
    });

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("INVALID_CURRENT_PASSWORD");
  });

  it("rejects reusing the current password", async () => {
    const { accessToken } = await registerUser(app);

    const res = await changePassword(accessToken, {
      currentPassword: "correct horse battery",
      newPassword: "correct horse battery",
    });

    expect(res.status).toBe(400);
    expect(res.body.details[0].path).toBe("newPassword");
  });

  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/v1/authentication/change-password")
      .send({ currentPassword: "x", newPassword: "long password" });

    expect(res.status).toBe(401);
  });
});

describe("side effects of registration", () => {
  it("queues a welcome email", async () => {
    const { app, jobQueue } = await createTestApp();

    await registerUser(app, { name: "Ann", email: "ann@x.com" });

    expect(jobQueue.jobs).toEqual([
      {
        name: "send-email",
        data: expect.objectContaining({ to: "ann@x.com", subject: "Welcome!" }),
      },
    ]);
  });
});
