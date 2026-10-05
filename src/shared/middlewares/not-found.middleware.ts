import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { sendError } from "../http/response";

export const notFoundMiddleware: RequestHandler = (req, res) => {
  sendError(
    res,
    StatusCodes.NOT_FOUND,
    `Route ${req.method} ${req.path} not found`,
    "ROUTE_NOT_FOUND",
  );
};
