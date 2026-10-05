import type { RequestHandler } from "express";
import type { ParamsDictionary, Query } from "express-serve-static-core";
import { z } from "zod";

import { HttpError } from "../errors/http-error";

type ValidationSchemas = {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
};

/** Output type of a schema, or the Express default when none is given. */
type Parsed<S, Fallback> = S extends z.ZodType ? z.output<S> : Fallback;

/**
 * Converts Zod issues into a compact client-friendly shape.
 */
export const formatZodError = (error: z.ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

/**
 * Validates request body, params, and query with Zod schemas.
 *
 * Parsed values replace the raw ones, so the next handlers receive sanitized
 * and transformed data. The returned handler is typed from the schemas, so a
 * controller typed with `z.infer<typeof schema>` must agree with it.
 */
export const validate =
  <S extends ValidationSchemas>(
    schemas: S,
  ): RequestHandler<
    Parsed<S["params"], ParamsDictionary>,
    unknown,
    Parsed<S["body"], unknown>,
    Parsed<S["query"], Query>
  > =>
  (req, _res, next) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body) as typeof req.body;
      }

      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as typeof req.params;
      }

      if (schemas.query) {
        // Express 5 exposes req.query as a getter, so the parsed value is
        // defined as an own property that shadows it for this request.
        Object.defineProperty(req, "query", {
          value: schemas.query.parse(req.query),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }

      next();
    } catch (error) {
      if (error instanceof z.ZodError) {
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
