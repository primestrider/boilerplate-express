import { StatusCodes } from "http-status-codes";

type HttpErrorOptions = {
  statusCode?: number;
  errorCode?: string;
  details?: unknown;
};

type FactoryOptions = Omit<HttpErrorOptions, "statusCode">;

/**
 * Expected, client-facing error.
 *
 * Throw it from services or middleware; the error middleware turns it into the
 * standard error response. Anything that is not an HttpError is treated as an
 * unexpected 500.
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

  static badRequest(message: string, options: FactoryOptions = {}) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.BAD_REQUEST,
    });
  }

  static unauthorized(message: string, options: FactoryOptions = {}) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.UNAUTHORIZED,
    });
  }

  static notFound(message: string, options: FactoryOptions = {}) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.NOT_FOUND,
    });
  }

  static conflict(message: string, options: FactoryOptions = {}) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.CONFLICT,
    });
  }

  static serviceUnavailable(message: string, options: FactoryOptions = {}) {
    return new HttpError(message, {
      ...options,
      statusCode: StatusCodes.SERVICE_UNAVAILABLE,
    });
  }
}
