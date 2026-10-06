import type { ErrorRequestHandler } from "express";
import { getReasonPhrase, ReasonPhrases, StatusCodes } from "http-status-codes";
import { DrizzleQueryError } from "drizzle-orm";
import multer from "multer";
import { ZodError } from "zod";

import { logger } from "../../config/logger";
import { isUniqueViolation } from "../../db/errors";
import { HttpError } from "../errors/http-error";
import { sendError } from "../http/response";
import { formatZodError } from "./validate.middleware";

/**
 * Errors created with the `http-errors` package, which Express middleware such
 * as body-parser use (malformed JSON, payload too large, ...).
 */
type ClientHttpError = Error & { status: number; expose?: boolean };

const isClientHttpError = (error: unknown): error is ClientHttpError => {
  const status = (error as { status?: unknown } | null)?.status;

  return (
    error instanceof Error &&
    typeof status === "number" &&
    status >= 400 &&
    status < 500
  );
};

/** "Payload Too Large" -> "PAYLOAD_TOO_LARGE" */
const toErrorCode = (status: number) =>
  getReasonPhrase(status)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");

type ErrorMiddlewareOptions = {
  /** Adds the stack trace of unexpected errors to 500 responses. */
  exposeStack: boolean;
};

/**
 * Creates the centralized error serializer.
 *
 * This middleware must be registered after all routes so every thrown error can
 * be converted into the standard API response format.
 */
export const createErrorMiddleware =
  ({ exposeStack }: ErrorMiddlewareOptions): ErrorRequestHandler =>
  (error, _req, res, next) => {
    const { requestId } = res.locals;

    // A stream failed mid-response: too late for a JSON body. Express's
    // default handler closes the connection.
    if (res.headersSent) {
      logger.error("Error after response started", {
        requestId,
        error: error.message,
      });
      next(error);
      return;
    }

    if (error instanceof ZodError) {
      sendError(
        res,
        StatusCodes.BAD_REQUEST,
        "Validation error",
        "VALIDATION_ERROR",
        { details: formatZodError(error) },
      );
      return;
    }

    if (error instanceof HttpError) {
      sendError(res, error.statusCode, error.message, error.errorCode, {
        details: error.details,
      });
      return;
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        sendError(
          res,
          StatusCodes.REQUEST_TOO_LONG,
          "File is too large",
          "FILE_TOO_LARGE",
        );
        return;
      }

      sendError(res, StatusCodes.BAD_REQUEST, error.message, "INVALID_UPLOAD");
      return;
    }

    if (isClientHttpError(error)) {
      sendError(
        res,
        error.status,
        error.expose ? error.message : getReasonPhrase(error.status),
        toErrorCode(error.status),
      );
      return;
    }

    if (isUniqueViolation(error)) {
      sendError(
        res,
        StatusCodes.CONFLICT,
        "Resource already exists",
        "RESOURCE_ALREADY_EXISTS",
      );
      return;
    }

    if (error instanceof DrizzleQueryError) {
      // error.message also contains the query params (user data), so only the
      // SQL text and the driver error are logged.
      const cause = error.cause instanceof Error ? error.cause : undefined;

      logger.error("Database error", {
        requestId,
        query: error.query,
        error: cause?.message ?? String(error.cause),
        stack: cause?.stack,
      });

      sendError(
        res,
        StatusCodes.INTERNAL_SERVER_ERROR,
        ReasonPhrases.INTERNAL_SERVER_ERROR,
        "DATABASE_ERROR",
      );
      return;
    }

    logger.error("Unhandled error", {
      requestId,
      error: error.message,
      stack: error.stack,
    });

    sendError(
      res,
      StatusCodes.INTERNAL_SERVER_ERROR,
      ReasonPhrases.INTERNAL_SERVER_ERROR,
      "INTERNAL_SERVER_ERROR",
      // The stack (its first line is the original message) helps debugging
      // but must never reach clients in production.
      exposeStack ? { details: error.stack } : undefined,
    );
  };
