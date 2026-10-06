import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

import { runWithRequestContext } from "../context/request-context";

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
 * Assigns a request id to every request, echoes it in the response header,
 * and opens the request context (see request-context.ts) for the rest of the
 * request.
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

  runWithRequestContext({ requestId, ip: req.ip }, next);
};
