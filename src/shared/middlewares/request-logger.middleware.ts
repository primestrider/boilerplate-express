import type { RequestHandler } from "express";

import { logger } from "../../config/logger";

/**
 * Logs incoming HTTP requests after the response finishes.
 *
 * This gives each log entry the final status code and response time without
 * changing controller code. The query string is left out because it may carry
 * tokens or personal data.
 */
export const requestLoggerMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    logger.info("HTTP request completed", {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};
