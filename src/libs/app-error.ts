import { StatusCodes } from "http-status-codes";

type AppErrorOptions = {
  statusCode?: number;
  errorCode?: string;
  isOperational?: boolean;
  details?: unknown;
};

/**
 * Application-level error with HTTP metadata.
 *
 * Throw this from services or middleware when an error is expected and should
 * be returned to the client in a controlled format.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string | undefined;
  public readonly isOperational: boolean;
  public readonly details: unknown;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message);

    this.name = "AppError";
    this.statusCode = options.statusCode ?? StatusCodes.INTERNAL_SERVER_ERROR;
    this.errorCode = options.errorCode;
    this.isOperational = options.isOperational ?? true;
    this.details = options.details;

    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Creates a 400 Bad Request error.
   */
  static badRequest(
    message: string,
    options: Omit<AppErrorOptions, "statusCode"> = {},
  ) {
    return new AppError(message, {
      ...options,
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }

  /**
   * Creates a 404 Not Found error.
   */
  static notFound(
    message: string,
    options: Omit<AppErrorOptions, "statusCode"> = {},
  ) {
    return new AppError(message, {
      ...options,
      statusCode: StatusCodes.NOT_FOUND,
    });
  }

  /**
   * Creates a 409 Conflict error.
   */
  static conflict(
    message: string,
    options: Omit<AppErrorOptions, "statusCode"> = {},
  ) {
    return new AppError(message, {
      ...options,
      statusCode: StatusCodes.CONFLICT,
    });
  }
}
