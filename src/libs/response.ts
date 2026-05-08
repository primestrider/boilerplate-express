import { StatusCodes } from "http-status-codes";

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
 * The API relies on HTTP status codes for success or failure state, so this
 * shape intentionally does not include a `success` boolean.
 */
export type ApiResponse<T = unknown, M = unknown> = {
  message?: ResponseMessage;
  data?: T | null;
  meta?: M;
  errorCode?: string;
  details?: unknown;
};

type ResponseType = "success" | "error" | "paginated";

type FormatterInput<T = unknown, M = unknown> = {
  type: ResponseType;
  message?: ResponseMessage;
  data?: T | null;
  meta?: M;
  errorCode?: string;
  details?: unknown;
};

type ErrorOptions = {
  details?: unknown;
};

type HttpErrorOptions = {
  statusCode?: number;
  errorCode?: string;
  details?: unknown;
};

/**
 * Error type consumed by the centralized error middleware.
 *
 * It lives beside the response formatter so the API response contract and HTTP
 * error metadata stay in one small place.
 */
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string | undefined;
  public readonly details: unknown;

  constructor(message: string, options: HttpErrorOptions = {}) {
    super(message);

    this.name = "HttpError";
    this.statusCode = options.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR;
    this.errorCode = options.errorCode;
    this.details = options.details;

    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Creates a 400 Bad Request error.
   */
  static badRequest(
    message: string,
    options: Omit<HttpErrorOptions, "statusCode"> = {},
  ) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }

  /**
   * Creates a 404 Not Found error.
   */
  static notFound(
    message: string,
    options: Omit<HttpErrorOptions, "statusCode"> = {},
  ) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.NOT_FOUND,
    });
  }

  /**
   * Creates a 409 Conflict error.
   */
  static conflict(
    message: string,
    options: Omit<HttpErrorOptions, "statusCode"> = {},
  ) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.CONFLICT,
    });
  }
}

/**
 * Builds a response body from a response type.
 *
 * Most code should use responseFormatter.success/error/paginated for clearer
 * call sites. The callable formatter is kept for cases that need dynamic types.
 */
const baseFormatter = <T = unknown, M = unknown>(
  input: FormatterInput<T, M>,
): ApiResponse<T, M> => {
  const { type, message = null, data = null, meta, errorCode, details } = input;

  switch (type) {
    case "success":
      return {
        ...(message !== null ? { message } : {}),
        ...(data !== null ? { data } : {}),
      };

    case "error":
      return {
        ...(message !== null ? { message } : {}),
        ...(errorCode !== undefined ? { errorCode } : {}),
        ...(details !== undefined ? { details } : {}),
      };

    case "paginated":
      return {
        ...(message !== null ? { message } : {}),
        ...(data !== null ? { data } : {}),
        ...(meta !== undefined ? { meta } : {}),
      };

    default:
      return {
        message: "Invalid response type",
      };
  }
};

/**
 * Centralized response formatter used by controllers and middleware.
 */
export const responseFormatter = Object.assign(baseFormatter, {
  /**
   * Formats a successful response body.
   */
  success: <T = unknown>(
    data?: T,
    message: ResponseMessage = null,
  ): ApiResponse<T> => ({
    ...(message !== null ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  }),

  /**
   * Formats an error response body.
   */
  error: (
    message: ResponseMessage,
    errorCode?: string,
    options?: ErrorOptions,
  ): ApiResponse => ({
    ...(message !== null ? { message } : {}),
    ...(errorCode !== undefined ? { errorCode } : {}),
    ...(options?.details !== undefined ? { details: options.details } : {}),
  }),

  /**
   * Formats a paginated response body.
   */
  paginated: <T = unknown>(
    data: T,
    meta: PaginationMeta,
    message: ResponseMessage = null,
  ): ApiResponse<T, PaginationMeta> => ({
    ...(message !== null ? { message } : {}),
    data,
    meta,
  }),
});
