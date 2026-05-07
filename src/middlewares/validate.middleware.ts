import type { NextFunction, Request, Response } from "express";
import type { ParamsDictionary } from "express-serve-static-core";
import type { ParsedQs } from "qs";
import type { ZodSchema } from "zod";
import { ZodError } from "zod";

import { AppError } from "../libs/app-error";

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
  (schemas: ValidationSchemas) =>
  (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }

      if (schemas.params) {
        req.params = schemas.params.parse(req.params) as ParamsDictionary;
      }

      if (schemas.query) {
        req.query = schemas.query.parse(req.query) as ParsedQs;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          AppError.badRequest("Validation error", {
            errorCode: "VALIDATION_ERROR",
            details: formatZodError(error),
          }),
        );
        return;
      }

      next(error);
    }
  };
