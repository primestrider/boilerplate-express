import type { Response } from "express";

/**
 * Pagination metadata returned by list endpoints.
 */
export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ResponseMessage = string | Record<string, unknown> | null;

/**
 * Standard API response body.
 *
 * `statusCode` always mirrors the HTTP status of the response, so clients that
 * only see the body (logs, proxies, some HTTP wrappers) still know the outcome.
 * There is intentionally no `success` boolean: the status code says it.
 */
export type ApiResponse<T = unknown, M = unknown> = {
  statusCode: number;
  message?: ResponseMessage;
  data?: T;
  meta?: M;
  errorCode?: string;
  details?: unknown;
};

type ErrorOptions = {
  details?: unknown;
};

/*
 * Every JSON response goes through one of these helpers. They set the HTTP
 * status and write the same value into the body, so the two can never drift.
 */

/**
 * Sends a successful response.
 */
export const sendSuccess = <T = unknown>(
  res: Response,
  statusCode: number,
  data?: T,
  message: ResponseMessage = null,
): void => {
  const body: ApiResponse<T> = {
    statusCode,
    ...(message !== null ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  };

  res.status(statusCode).json(body);
};

/**
 * Sends a paginated list response.
 */
export const sendPaginated = <T = unknown>(
  res: Response,
  statusCode: number,
  data: T,
  meta: PaginationMeta,
  message: ResponseMessage = null,
): void => {
  const body: ApiResponse<T, PaginationMeta> = {
    statusCode,
    ...(message !== null ? { message } : {}),
    data,
    meta,
  };

  res.status(statusCode).json(body);
};

/**
 * Sends an error response.
 */
export const sendError = (
  res: Response,
  statusCode: number,
  message: ResponseMessage,
  errorCode?: string,
  options?: ErrorOptions,
): void => {
  const body: ApiResponse = {
    statusCode,
    ...(message !== null ? { message } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(options?.details !== undefined ? { details: options.details } : {}),
  };

  res.status(statusCode).json(body);
};
