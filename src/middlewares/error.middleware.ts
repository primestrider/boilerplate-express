import type { ErrorRequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { AppError } from "../libs/app-error";
import { responseFormatter } from "../libs/response";

const isProduction = env.NODE_ENV === "production";

/**
 * Centralized error serializer.
 *
 * This middleware must be registered after all routes so every thrown error can
 * be converted into the standard API response format.
 */
export const errorMiddleware: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next,
) => {
  if (error instanceof ZodError) {
    res.status(StatusCodes.BAD_REQUEST).json(
      responseFormatter.error("Validation error", "VALIDATION_ERROR", {
        details: error.issues,
      }),
    );
    return;
  }

  if (error instanceof AppError) {
    res.status(error.statusCode).json(
      responseFormatter.error(error.message, error.errorCode, {
        details: error.details,
      }),
    );
    return;
  }

  logger.error("Unhandled error", error);

  res
    .status(StatusCodes.INTERNAL_SERVER_ERROR)
    .json(
      responseFormatter.error(
        isProduction ? "Internal server error" : error.message,
        "INTERNAL_SERVER_ERROR",
        isProduction ? undefined : { details: error.stack },
      ),
    );
};
