import { DrizzleQueryError } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { createErrorMiddleware } from "./error.middleware";

/** Minimal app whose only route throws the given error. */
const appThrowing = (error: unknown) => {
  const app = express();
  app.get("/boom", () => {
    throw error;
  });
  app.use(createErrorMiddleware({ exposeStack: true }));
  return app;
};

describe("errorMiddleware", () => {
  it("answers unexpected errors with a generic 500 message", async () => {
    const res = await request(appThrowing(new Error("secret detail"))).get(
      "/boom",
    );

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({
      message: "Internal Server Error",
      errorCode: "INTERNAL_SERVER_ERROR",
    });
    // Outside production the stack is included for debugging.
    expect(res.body.details).toContain("secret detail");
  });

  it("hides the stack when exposeStack is off (production)", async () => {
    const app = express();
    app.get("/boom", () => {
      throw new Error("secret detail");
    });
    app.use(createErrorMiddleware({ exposeStack: false }));

    const res = await request(app).get("/boom");

    expect(res.body).toEqual({
      statusCode: 500,
      message: "Internal Server Error",
      errorCode: "INTERNAL_SERVER_ERROR",
    });
  });

  it("answers database errors with a generic 500 message", async () => {
    const error = new DrizzleQueryError(
      "select * from users where email = ?",
      ["r@x.com"],
      new Error("SQLITE_BUSY"),
    );

    const res = await request(appThrowing(error)).get("/boom");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      statusCode: 500,
      message: "Internal Server Error",
      errorCode: "DATABASE_ERROR",
    });
  });
});
