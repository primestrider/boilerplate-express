import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { MemoryCache, type Cache } from "../cache/cache";
import { sendSuccess } from "../http/response";
import { createErrorMiddleware } from "./error.middleware";
import { createIdempotency } from "./idempotency.middleware";

const createApp = (
  cache: Cache,
  handler: express.RequestHandler = (_req, res) => {
    sendSuccess(res, 201, { ok: true });
  },
) => {
  const app = express();
  app.use(express.json());
  app.post("/things", createIdempotency(cache), handler);
  app.use(createErrorMiddleware({ exposeStack: false }));
  return app;
};

describe("idempotency middleware", () => {
  it("answers 409 while the first request with the key is still running", async () => {
    let finish!: () => void;
    const app = createApp(
      new MemoryCache(),
      (_req, res) =>
        new Promise<void>((resolve) => {
          finish = () => {
            sendSuccess(res, 201, { ok: true });
            resolve();
          };
        }),
    );

    const first = request(app)
      .post("/things")
      .set("Idempotency-Key", "k")
      .send({ a: 1 })
      .then((res) => res);
    // Let the first request reach the handler.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await request(app)
      .post("/things")
      .set("Idempotency-Key", "k")
      .send({ a: 1 });
    finish();

    expect(second.status).toBe(409);
    expect(second.body.errorCode).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
    expect((await first).status).toBe(201);
  });

  it("does not store 5xx responses, so the client can retry", async () => {
    let calls = 0;
    const app = createApp(new MemoryCache(), () => {
      calls += 1;
      throw new Error("boom");
    });

    const send = () =>
      request(app).post("/things").set("Idempotency-Key", "k").send({});

    expect((await send()).status).toBe(500);
    expect((await send()).status).toBe(500);
    expect(calls).toBe(2);
  });

  it("refuses with a retryable 503 when the store is down", async () => {
    const broken: Cache = {
      get: () => Promise.reject(new Error("down")),
      set: () => Promise.reject(new Error("down")),
      setIfAbsent: () => Promise.reject(new Error("down")),
      delete: () => Promise.reject(new Error("down")),
    };
    const app = createApp(broken);

    const withKey = await request(app)
      .post("/things")
      .set("Idempotency-Key", "k")
      .send({});
    const withoutKey = await request(app).post("/things").send({});

    expect(withKey.status).toBe(503);
    expect(withKey.body.errorCode).toBe("IDEMPOTENCY_UNAVAILABLE");
    expect(withoutKey.status).toBe(201);
  });
});
