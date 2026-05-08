import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { ParamsDictionary, Query } from "express-serve-static-core";
import type { ZodSchema } from "zod";
import { ZodError } from "zod";

import { HttpError } from "../libs/response";

type ValidationSchemas = {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
};

/**
 * Converts Zod issues into a compact client-friendly shape.
 */
const formatZodError = (error: ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

/**
 * Validates request body, params, and query with Zod schemas.
 *
 * Parsed values are assigned back to the request object, so controllers receive
 * sanitized and transformed data.
 */
export const validate =
  <
    Params = ParamsDictionary,
    ResBody = unknown,
    ReqBody = unknown,
    ReqQuery = Query,
  >(
    schemas: ValidationSchemas,
  ): RequestHandler<Params, ResBody, ReqBody, ReqQuery> =>
  (
    req: Request<Params, ResBody, ReqBody, ReqQuery>,
    _res: Response<ResBody>,
    next: NextFunction,
  ) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body) as ReqBody;
      }

      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as Params;
      }

      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as ReqQuery;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          HttpError.badRequest("Validation error", {
            errorCode: "VALIDATION_ERROR",
            details: formatZodError(error),
          }),
        );
        return;
      }

      next(error);
    }
  };
