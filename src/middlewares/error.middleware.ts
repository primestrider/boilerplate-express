import type { ErrorRequestHandler } from "express";
import { StatusCodes } from "http-status-codes";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { HttpError, responseFormatter } from "../libs/response";

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

  if (error instanceof HttpError) {
    res.status(error.statusCode).json(
      responseFormatter.error(error.message, error.errorCode, {
        details: error.details,
      }),
    );
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      res
        .status(StatusCodes.CONFLICT)
        .json(
          responseFormatter.error(
            "Resource already exists",
            "RESOURCE_ALREADY_EXISTS",
          ),
        );
      return;
    }

    logger.error("Prisma error", error);

    res
      .status(StatusCodes.INTERNAL_SERVER_ERROR)
      .json(responseFormatter.error("Database error", "DATABASE_ERROR"));
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
