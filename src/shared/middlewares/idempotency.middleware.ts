import { createHash } from "node:crypto";
import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { logger } from "../../config/logger";
import type { Cache } from "../cache/cache";
import { HttpError } from "../errors/http-error";

const HEADER = "Idempotency-Key";
const VALID_KEY = /^[A-Za-z0-9._:-]{1,255}$/;

/** How long a finished response can be replayed. */
const RESULT_TTL_SECONDS = 24 * 60 * 60;
/** Upper bound for a request in progress; a crashed one frees its key. */
const LOCK_TTL_SECONDS = 60;

type IdempotencyRecord =
  | { state: "processing"; fingerprint: string }
  | {
      state: "completed";
      fingerprint: string;
      statusCode: number;
      body: unknown;
    };

/** Identifies the request a key was first used with. */
const fingerprintOf = (
  method: string,
  path: string,
  body: unknown,
  file: Express.Multer.File | undefined,
) =>
  createHash("sha256")
    .update(method)
    .update(path)
    .update(JSON.stringify(body ?? null))
    .update(file ? createHash("sha256").update(file.buffer).digest("hex") : "")
    .digest("hex");

/**
 * Makes unsafe requests safe to retry. A client sends a unique
 * `Idempotency-Key`; the first response is stored and a retry with the same
 * key gets that response again (`Idempotent-Replayed: true`) instead of
 * repeating the action.
 *
 * - Same key while the first request still runs: 409.
 * - Same key with a different request: 422.
 * - 5xx responses are not stored, so the client can retry them.
 *
 * Place it after `authenticate` (keys are scoped per user, or per IP for
 * public routes) and after body parsing (the body is part of the fingerprint).
 * Requests without the header pass through.
 */
export const createIdempotency =
  (cache: Cache): RequestHandler =>
  async (req, res, next) => {
    const key = req.get(HEADER);

    if (key === undefined) {
      next();
      return;
    }

    if (!VALID_KEY.test(key)) {
      throw HttpError.badRequest(
        `${HEADER} must be 1-255 characters of [A-Za-z0-9._:-]`,
        {
          errorCode: "INVALID_IDEMPOTENCY_KEY",
        },
      );
    }

    const scope = res.locals.auth?.userId ?? `ip:${req.ip}`;
    const cacheKey = `idempotency:${scope}:${key}`;
    const fingerprint = fingerprintOf(
      req.method,
      req.originalUrl,
      req.body,
      req.file,
    );

    // Without the store the guarantee cannot be kept, so the request is
    // refused (retryable 503) rather than run unprotected.
    const unavailable = (error: unknown): never => {
      logger.error("Idempotency store unavailable", {
        requestId: res.locals.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw HttpError.serviceUnavailable(
        "Idempotent requests are temporarily unavailable, please retry",
        { errorCode: "IDEMPOTENCY_UNAVAILABLE" },
      );
    };

    const acquired = await cache
      .setIfAbsent(
        cacheKey,
        { state: "processing", fingerprint } satisfies IdempotencyRecord,
        LOCK_TTL_SECONDS,
      )
      .catch(unavailable);

    if (!acquired) {
      const existing = await cache
        .get<IdempotencyRecord>(cacheKey)
        .catch(unavailable);

      if (existing && existing.fingerprint !== fingerprint) {
        throw new HttpError(
          `${HEADER} was already used for a different request`,
          {
            statusCode: StatusCodes.UNPROCESSABLE_ENTITY,
            errorCode: "IDEMPOTENCY_KEY_REUSED",
          },
        );
      }

      if (existing?.state === "completed") {
        res.set("Idempotent-Replayed", "true");
        // Replays a body built earlier by the response helpers, unchanged.
        res.status(existing.statusCode).json(existing.body);
        return;
      }

      // Still processing, or the record expired between the two calls.
      throw HttpError.conflict(
        "A request with this Idempotency-Key is in progress",
        {
          errorCode: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
        },
      );
    }

    let responseBody: unknown;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      responseBody = body;
      return json(body);
    };

    const release = () => {
      const store =
        res.statusCode >= 500 || !res.writableFinished
          ? cache.delete(cacheKey)
          : cache.set(
              cacheKey,
              {
                state: "completed",
                fingerprint,
                statusCode: res.statusCode,
                body: responseBody,
              } satisfies IdempotencyRecord,
              RESULT_TTL_SECONDS,
            );

      store.catch((error: unknown) => {
        logger.error("Failed to store idempotency record", {
          requestId: res.locals.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };

    // "close" also fires when the client disconnects before the response
    // was written; then the key is released instead of stored.
    res.once("close", release);

    next();
  };
