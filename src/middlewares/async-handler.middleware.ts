import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ParamsDictionary, Query } from "express-serve-static-core";

/**
 * Wraps async request handlers and forwards rejected promises to Express.
 *
 * This keeps controllers free from repetitive try/catch blocks while preserving
 * Express request handler generics.
 */
export const asyncHandler =
  <
    Params = ParamsDictionary,
    ResBody = unknown,
    ReqBody = unknown,
    ReqQuery = Query,
    Locals extends Record<string, unknown> = Record<string, unknown>,
  >(
    handler: RequestHandler<Params, ResBody, ReqBody, ReqQuery, Locals>,
  ): RequestHandler<Params, ResBody, ReqBody, ReqQuery, Locals> =>
  (
    req: Request<Params, ResBody, ReqBody, ReqQuery, Locals>,
    res: Response<ResBody, Locals>,
    next: NextFunction,
  ) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
