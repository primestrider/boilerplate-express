import type { RequestHandler } from "express";

import { logger } from "../config/logger";

/**
 * Logs incoming HTTP requests after the response finishes.
 *
 * This gives each log entry the final status code and response time without
 * changing controller code.
 */
export const requestLoggerMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    logger.info("HTTP request completed", {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};
