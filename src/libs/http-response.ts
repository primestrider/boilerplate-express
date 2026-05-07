import type { Response } from "express";
import { StatusCodes } from "http-status-codes";

import {
  type PaginationMeta,
  type ResponseMessage,
  responseFormatter,
} from "./response";

/**
 * Sends a successful JSON response.
 */
export const sendSuccess = <T>(
  res: Response,
  data: T,
  message: ResponseMessage = null,
  statusCode: number = StatusCodes.OK,
) => res.status(statusCode).json(responseFormatter.success(data, message));

/**
 * Sends a 201 Created JSON response.
 */
export const sendCreated = <T>(
  res: Response,
  data: T,
  message: ResponseMessage = null,
) => sendSuccess(res, data, message, StatusCodes.CREATED);

/**
 * Sends a paginated JSON response.
 */
export const sendPaginated = <T>(
  res: Response,
  data: T,
  meta: PaginationMeta,
  message: ResponseMessage = null,
) =>
  res
    .status(StatusCodes.OK)
    .json(responseFormatter.paginated(data, meta, message));
