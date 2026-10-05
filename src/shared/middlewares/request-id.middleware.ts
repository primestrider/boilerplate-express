import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
    }
  }
}

const REQUEST_ID_HEADER = "X-Request-Id";
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Assigns a request id to every request and echoes it in the response header.
 *
 * An incoming X-Request-Id (e.g. from a load balancer) is reused only when it
 * has a safe shape, so arbitrary client input never reaches the logs.
 */
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const requestId =
    incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  res.locals.requestId = requestId;
  res.set(REQUEST_ID_HEADER, requestId);

  next();
};
