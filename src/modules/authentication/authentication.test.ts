import argon2 from "argon2";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestApp, registerUser } from "../../test/create-test-app";

const SECRET = process.env.JWT_SECRET as string;

describe("authentication", () => {
  let app: ReturnType<typeof createTestApp>["app"];
  let db: ReturnType<typeof createTestApp>["db"];

  beforeEach(() => {
    ({ app, db } = createTestApp());
  });

  const login = (email: string, password: string) =>
    request(app).post("/api/authentication/login").send({ email, password });

  describe("POST /api/authentication/register", () => {
    it("creates a user, returns a token, and never exposes the hash", async () => {
      const res = await request(app).post("/api/authentication/register").send({
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

      const row = db.$client
        .prepare("select password_hash from users")
        .get() as { password_hash: string };

      expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    });

    it("rejects a duplicate email regardless of case", async () => {
      await registerUser(app, { email: "r@x.com" });

      const res = await request(app).post("/api/authentication/register").send({
        name: "Other",
        email: "R@X.COM",
        password: "another password",
      });

      expect(res.status).toBe(409);
      expect(res.body.errorCode).toBe("EMAIL_ALREADY_EXISTS");
    });

    it("rejects a short password", async () => {
      const res = await request(app)
        .post("/api/authentication/register")
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
      db.$client.prepare("update users set password_hash = ?").run(weakHash);

      const res = await login("r@x.com", "correct horse battery");

      const row = db.$client
        .prepare("select password_hash from users")
        .get() as { password_hash: string };
      expect(res.status).toBe(200);
      expect(row.password_hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
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
        .get("/api/authentication/profile")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe("r@x.com");
      expect(res.headers["www-authenticate"]).toBeUndefined();
    });

    it("requires a token", async () => {
      const res = await request(app).get("/api/authentication/profile");

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
        .get("/api/authentication/profile")
        .set("Authorization", `Bearer ${forged}`);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("INVALID_TOKEN");
    });

    it("rejects an unsigned (alg: none) token", async () => {
      const unsigned = jwt.sign({ sub: "x" }, "", { algorithm: "none" });

      const res = await request(app)
        .get("/api/authentication/profile")
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
        .get("/api/authentication/profile")
        .set("Authorization", `Bearer ${expired}`);

      expect(res.status).toBe(401);
      expect(res.body.errorCode).toBe("TOKEN_EXPIRED");
    });

    it("returns 404 when the token's user no longer exists", async () => {
      const { accessToken } = await registerUser(app);
      db.$client.prepare("delete from users").run();

      const res = await request(app)
        .get("/api/authentication/profile")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.errorCode).toBe("USER_NOT_FOUND");
    });
  });
});
