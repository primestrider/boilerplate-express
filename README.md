# boilerplate-express

REST API boilerplate built with **Express 5 + TypeScript + Drizzle ORM (MySQL via mysql2)**, with optional **Redis** for shared caching, rate limiting, idempotency and **BullMQ** background jobs. Code is organized by feature module, each layered as routes → controller → service → repository, with constructor-based dependency injection wired from a single composition root.

## Features

**Foundation**

- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Environment validation** at startup with Zod (`src/config/env.ts`): the app refuses to start if env is invalid; empty optional values count as unset
- **App factory + composition root**: `createApp(deps)` builds the app without listening; `server.ts` creates the real dependencies (MySQL pool, Redis, queue, storage), tests inject a test database and in-memory services. Modules declare their own dependencies and are wired once in `routes.ts`
- **Request context** with `AsyncLocalStorage` (`src/shared/context/request-context.ts`): request id, IP and caller are available anywhere in the request (used by the audit log)

**API design**

- **Versioned routes**: features under `/api/v1`, health checks and docs unversioned
- **Request validation** (body / params / query) with Zod via the `validate` middleware, typed from the schemas
- **Pagination, filtering, search and sorting** (`src/shared/http/pagination.ts`, see `GET /users`)
- **Consistent response format** via `sendSuccess` / `sendPaginated` / `sendError`, which set the HTTP status and echo it as `statusCode` in the body, and `HttpError` with stable `errorCode`s
- **Idempotency keys** (`Idempotency-Key` header) make unsafe requests safe to retry (`src/shared/middlewares/idempotency.middleware.ts`)
- **Compression** (gzip/brotli) and **ETags** (`304 Not Modified` for unchanged GET responses)
- **File uploads**: multipart via multer, type detected from the file's bytes (not its name), size limit, owner-only access, streaming download, pluggable storage (`FileStorage`)
- **API docs**: OpenAPI 3.1 generated from the Zod schemas, with Swagger UI at `/api/docs` (disabled in production)

**Security**

- **Authentication**: register/login with Argon2id (OWASP parameters, automatic rehash), short-lived HS256 JWT access tokens with a pinned algorithm, rotating refresh tokens (stored hashed, reuse revokes the session), logout, password change (ends every session), identical responses for unknown email vs. wrong password
- **Authorization**: `user` / `admin` roles, `requireRole(...)` middleware and `assertOwnerOrRole(...)` for owner-or-admin access
- **Audit log** of security-relevant actions (logins, failed logins, role changes, deletions, uploads...) with actor, IP and request id, readable by admins
- `helmet`, CORS allowlist (`*` rejected in production), per-IP rate limits (shared through Redis when configured), stricter limit on credential endpoints, `trust proxy` off by default, JSON body capped at 100kb

**Data and infrastructure**

- **MySQL** with a connection pool, UTC timestamps, migrations applied by a runtime script (no dev dependencies needed in production)
- **Soft delete** for users (history and foreign keys stay intact)
- **Cache-aside** user cache (`CachedUserRepository`) evicted on every write
- **Background jobs** with BullMQ and a separate worker process (retries with exponential backoff); emails are sent as jobs
- **Email** via nodemailer (SMTP); without `SMTP_HOST` emails are logged instead
- **Degrades instead of failing**: without `REDIS_URL` everything runs in-process; if Redis goes down at runtime, rate limits and the cache let requests through, notification emails are skipped (logged), and idempotent requests answer a retryable 503
- **Health checks**: `/api/health/live` and `/api/health/ready` (database and Redis, 503 naming what is down)
- **Graceful shutdown** (SIGINT/SIGTERM) for the API (drains requests, then closes queue, MySQL and Redis) and the worker (finishes active jobs)
- **Docker**: multi-stage `Dockerfile` (non-root) and `docker-compose.yml` with MySQL, Redis, a one-shot migration, the API and the worker

**Quality**

- **Logging**: JSON logs with Winston + request logger (request id, method, path without query string, status, duration)
- **Tests**: Vitest + Supertest integration tests against real MySQL (one database per test worker), unit tests with fakes, and Redis tests when `TEST_REDIS_URL` is set
- **Tooling**: ESLint (typescript-eslint) + Prettier, LF line endings, GitHub Actions CI on Node 22 and 24 with MySQL and Redis service containers, plus a Docker build check

## Prerequisites

- Node.js 22.12+ (see `engines`; tested on Node 24, `.nvmrc` pins 24)
- npm
- Docker (for MySQL and Redis), or your own MySQL 8 and Redis 7

## Getting Started

```bash
npm install
cp .env.example .env
# set JWT_SECRET in .env (at least 32 chars), e.g.:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

docker compose up -d mysql redis   # MySQL on 127.0.0.1:3306, Redis on 6379
npm run db:migrate                 # applies migrations to DATABASE_URL
npm run dev                        # http://localhost:3000, docs at /api/docs
npm run worker                     # processes background jobs (needs REDIS_URL)

# optional: make a registered user an admin
npm run user:make-admin -- you@example.com
```

Without Redis, leave `REDIS_URL` empty: jobs then run inside the API process and no worker is needed.

### Full stack in Docker

```bash
docker compose up -d --build   # mysql, redis, migrate (one-shot), app on :3000, worker
```

The containers read `.env` and override only the database and Redis hosts. The credentials in `docker-compose.yml` (`app`/`app`, root `root`) are for local use only.

## Environment Variables

| Variable                    | Default                              | Description                                                                                                             |
| --------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | — (required)                         | `development` \| `test` \| `production`. Required so a server never silently falls back to dev error output             |
| `PORT`                      | `3000`                               | HTTP port                                                                                                               |
| `CORS_ORIGIN`               | `*`                                  | Comma-separated origins, e.g. `https://a.com,https://b.com`. `*` = allow all (not allowed in production)                |
| `TRUST_PROXY`               | `0`                                  | Number of reverse proxies in front of the app. Set it to the real hop count; a higher value lets clients spoof their IP |
| `RATE_LIMIT_MAX`            | `100`                                | Max requests per IP per minute                                                                                          |
| `DATABASE_URL`              | — (required)                         | `mysql://user:password@host:3306/database`                                                                              |
| `REDIS_URL`                 | — (optional)                         | `redis://host:6379`. Enables the shared cache, rate limits, idempotency store and BullMQ jobs                           |
| `JWT_SECRET`                | — (required)                         | HS256 signing key, at least 32 characters. Rotating it invalidates every issued token                                   |
| `JWT_TTL_SECONDS`           | `900`                                | Access token lifetime in seconds                                                                                        |
| `REFRESH_TOKEN_TTL_SECONDS` | `2592000`                            | Refresh token lifetime in seconds (30 days)                                                                             |
| `SMTP_HOST`                 | — (optional)                         | SMTP server. Without it emails are only logged                                                                          |
| `SMTP_PORT`                 | `587`                                | `465` uses implicit TLS, other ports STARTTLS                                                                           |
| `SMTP_USER` / `SMTP_PASS`   | —                                    | SMTP credentials                                                                                                        |
| `MAIL_FROM`                 | `Boilerplate <no-reply@example.com>` | Sender address                                                                                                          |
| `UPLOAD_DIR`                | `uploads`                            | Where uploaded files are stored                                                                                         |
| `UPLOAD_MAX_BYTES`          | `5242880`                            | Maximum upload size (5 MiB)                                                                                             |

## Scripts

| Script                               | Description                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `npm run dev`                        | Start the API with auto-reload (tsx)                                          |
| `npm run worker`                     | Start the job worker with auto-reload                                         |
| `npm run build`                      | Compile TypeScript to `dist/` (tests excluded)                                |
| `npm start` / `npm run start:worker` | Run the compiled API / worker                                                 |
| `npm run typecheck`                  | Type-check everything, including tests                                        |
| `npm test`                           | Run the test suite once (needs MySQL, see [Testing](#testing))                |
| `npm run test:watch`                 | Run tests in watch mode                                                       |
| `npm run db:generate`                | Generate a SQL migration from the schema                                      |
| `npm run db:migrate`                 | Apply pending migrations (`node dist/db/migrate.js` after a build)            |
| `npm run db:studio`                  | Open Drizzle Studio                                                           |
| `npm run lint` / `lint:fix`          | ESLint                                                                        |
| `npm run format` / `format:check`    | Prettier                                                                      |
| `npm run user:make-admin -- <email>` | Promote a user to admin (`node dist/cli/make-admin.js <email>` after a build) |

## Project Structure

```
drizzle/                     # generated SQL migrations (commit these)
Dockerfile, docker-compose.yml
src/
  server.ts                  # composition root: MySQL, Redis, queue, storage; listens; graceful shutdown
  worker.ts                  # BullMQ worker process
  app.ts                     # createApp(deps): global middleware + routes, no listen
  routes.ts                  # builds and wires every feature module, mounts /api/v1
  cli/make-admin.ts          # promote a user to admin
  docs/                      # OpenAPI document + Swagger UI router
  config/                    # env, logger, cors, rate limit
  db/
    index.ts                 # createDatabase(url) + DB type
    schema.ts                # Drizzle table definitions
    migrate.ts               # applies migrations
    errors.ts                # driver error helpers (duplicate key, affected rows)
  jobs/jobs.ts               # job names/payloads, handlers, BullMQ and inline queues
  shared/
    cache/                   # Cache interface, Redis and in-memory implementations
    context/                 # per-request context (AsyncLocalStorage)
    errors/http-error.ts     # HttpError
    http/                    # response helpers, pagination
    mail/                    # Mailer (nodemailer)
    middlewares/             # validate, error, 404, request id, request logger, idempotency
    storage/                 # FileStorage interface + local disk implementation
  modules/
    audit/                   # audit log: recording + admin listing
    authentication/          # register, login, refresh, logout, change password, profile, tokens, emails
    files/                   # upload, list, download, delete
    health/                  # liveness + readiness
    users/                   # CRUD with search/filter/sort, roles, soft delete, cached repository
  test/
    create-test-app.ts       # app + migrated MySQL test database + in-memory services
```

### Module anatomy

Each module lives in `src/modules/<name>/` and consists of:

| File              | Responsibility                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `*.schema.ts`     | Zod request schemas + DTO types inferred with `z.infer`                                                                          |
| `*.routes.ts`     | Route definitions: `validate(...)` followed by the controller handler                                                            |
| `*.controller.ts` | HTTP concerns only: read the request, check who may act, call the service, send the response                                     |
| `*.service.ts`    | Business rules; throws `HttpError` for domain cases (not found, conflict); records audit entries                                 |
| `*.repository.ts` | Repository interface + Drizzle implementation (the only layer touching the DB)                                                   |
| `*.entity.ts`     | Internal data types                                                                                                              |
| `*.mapper.ts`     | Entity → response DTO (the place to strip sensitive fields)                                                                      |
| `*.module.ts`     | `create<Name>Module(deps)`: declares its dependencies, wires repository → service → controller, returns `{ router, ...exports }` |
| `*.test.ts`       | Integration tests (Supertest) and unit tests next to the code they cover                                                         |

### Adding a new module

1. Add the table to `src/db/schema.ts`, then run `npm run db:generate` and `npm run db:migrate`.
2. Create `src/modules/<name>/` following the `users` module pattern. For lists, extend `paginationQuerySchema` and return `paginate(rows, total, query)`.
3. Build and mount it in `src/routes.ts`, passing only what it needs (including other modules' exports):

   ```ts
   const products = createProductModule({
     db,
     authenticate,
     auditService: audit.service,
   });
   v1.use("/products", products.router);
   ```

4. Protect routes with the injected `authenticate` middleware, restrict them with `requireRole("admin")` or `assertOwnerOrRole(getAuth(res), ownerId, "admin")`, and read the caller with `getAuth(res)`.
5. Record security-relevant actions with `auditService.record({ action, entityType, entityId })` (add the action to `AUDIT_ACTIONS`).
6. Add `idempotency` (from `routes.ts`) to POST routes whose retries must not repeat the action.
7. Document the routes in `src/docs/openapi.ts` (reuse the module's Zod schemas).

### Adding a background job

1. Add the job and its payload to `JobPayloads` in `src/jobs/jobs.ts` and its handler to `createJobHandlers`.
2. Queue it from a service with `jobQueue.add("job-name", payload)` (inject `jobQueue` through the module).

The worker picks it up automatically. Keep payloads small and serializable (ids, not entities), and make handlers safe to run more than once: failed jobs are retried.

## API

Base URL: `/api`. Feature routes are under `/api/v1`.

| Method | Endpoint                             | Description                                                                                                         |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/health/live`                       | Liveness: process is up (uptime, timestamp)                                                                         |
| GET    | `/health/ready`                      | Readiness: database (and Redis, if configured) reachable, otherwise 503 naming what is down                         |
| POST   | `/v1/authentication/register`        | Create an account (`name` 2–100 chars, `email`, `password` 8–128 chars); returns the user + tokens, sends email     |
| POST   | `/v1/authentication/login`           | Exchange email + password for tokens                                                                                |
| POST   | `/v1/authentication/refresh`         | Exchange a refresh token for a new token pair (the old one stops working)                                           |
| POST   | `/v1/authentication/logout`          | End the session a refresh token belongs to                                                                          |
| POST   | `/v1/authentication/change-password` | 🔒 Change the password (`currentPassword`, `newPassword`); ends every session                                       |
| GET    | `/v1/authentication/profile`         | 🔒 Current user profile                                                                                             |
| GET    | `/v1/users`                          | 🔒 Admin. List users: `page`, `limit` (1–100), `search`, `role`, `sortBy` (`createdAt`/`name`/`email`), `sortOrder` |
| GET    | `/v1/users/:id`                      | 🔒 Owner or admin. Get a user                                                                                       |
| PATCH  | `/v1/users/:id`                      | 🔒 Owner or admin. Update `name` and/or `email`                                                                     |
| PATCH  | `/v1/users/:id/role`                 | 🔒 Admin, not on themselves. Change `role`                                                                          |
| DELETE | `/v1/users/:id`                      | 🔒 Owner or admin. Soft delete                                                                                      |
| POST   | `/v1/files`                          | 🔒 Upload one file (multipart field `file`; PNG, JPEG, GIF, WebP or PDF). Supports `Idempotency-Key`                |
| GET    | `/v1/files`                          | 🔒 The caller's files (paginated)                                                                                   |
| GET    | `/v1/files/:id`                      | 🔒 Owner or admin. File metadata                                                                                    |
| GET    | `/v1/files/:id/content`              | 🔒 Owner or admin. Download the file                                                                                |
| DELETE | `/v1/files/:id`                      | 🔒 Owner or admin. Delete the file                                                                                  |
| GET    | `/v1/audit-logs`                     | 🔒 Admin. Audit trail: `page`, `limit`, `actorId`, `action`, `entityType`, `entityId`                               |
| GET    | `/docs`                              | Swagger UI; raw spec at `/docs/openapi.json` (not served in production)                                             |

🔒 = requires `Authorization: Bearer <accessToken>`. `register`, `login`, `refresh` and `change-password` share a stricter limiter: 10 failed attempts per IP per 15 minutes.

### Tokens and roles

- **Access token**: HS256 JWT, `sub` = user id plus a `role` claim, valid for `JWT_TTL_SECONDS` (15 min). Stateless, so a role change or account deletion takes effect once the token expires; the next refresh picks it up.
- **Refresh token**: random 256-bit string, stored only as a SHA-256 hash, valid for `REFRESH_TOKEN_TTL_SECONDS` (30 days). Each refresh returns a new pair and retires the old token. Presenting a retired token means it leaked, so every token of that session is revoked. Each login starts its own session, so logging out on one device keeps the others. Changing the password revokes all sessions.
- **Roles**: `user` (default for every registration) and `admin`. Admins change roles with `PATCH /v1/users/:id/role` (never their own, so the last admin cannot lock everyone out); promote the first admin with `npm run user:make-admin -- <email>`.
- Tokens are returned in the JSON body. Browser clients should keep the refresh token out of reach of scripts (e.g. move it to an `HttpOnly` cookie at a BFF/proxy).

### Deleted users

`DELETE /v1/users/:id` sets `deletedAt` instead of removing the row: the user disappears from every query, can no longer log in or refresh, and the email stays reserved (registering it again answers 409). Their files and audit history are kept.

### Idempotency

Send `Idempotency-Key: <unique value>` (1–255 chars of `A-Za-z0-9._:-`) on `POST /v1/files` to make retries safe. Keys are scoped per user and kept for 24 hours:

| Situation                                      | Response                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| First request                                  | Runs normally; the response is stored                                    |
| Retry with the same key and the same request   | The stored response, with `Idempotent-Replayed: true` (also for 4xx)     |
| Retry while the first request is still running | 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`                                    |
| Same key, different request                    | 422 `IDEMPOTENCY_KEY_REUSED`                                             |
| First request failed with 5xx                  | Not stored; the retry runs again                                         |
| Idempotency store (Redis) unavailable          | 503 `IDEMPOTENCY_UNAVAILABLE` (retry later); requests without a key work |

### Response format

Every JSON body includes `statusCode`, which always equals the HTTP status of the response (success and error alike). Success or failure is expressed by that status code, so bodies have no `success` field.

Controllers and middleware never call `res.json` directly; they use `sendSuccess`, `sendPaginated` or `sendError`, which set the HTTP status and the body field from one value so the two cannot drift. (The only exception is the idempotency middleware replaying a body those helpers built.)

Success:

```json
{
  "statusCode": 200,
  "message": "User retrieved successfully",
  "data": { "id": "...", "name": "Ricky", "email": "r@x.com" }
}
```

Paginated:

```json
{
  "statusCode": 200,
  "message": "Users retrieved successfully",
  "data": [],
  "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
}
```

Error:

```json
{
  "statusCode": 400,
  "message": "Validation error",
  "errorCode": "VALIDATION_ERROR",
  "details": [{ "path": "email", "message": "Invalid email address" }]
}
```

Error codes in use: `VALIDATION_ERROR`, `BAD_REQUEST` (malformed JSON), `REQUEST_ENTITY_TOO_LARGE`, `ROUTE_NOT_FOUND`, `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `INVALID_CURRENT_PASSWORD`, `FORBIDDEN`, `USER_NOT_FOUND`, `EMAIL_ALREADY_EXISTS`, `CANNOT_CHANGE_OWN_ROLE`, `FILE_REQUIRED`, `FILE_TOO_LARGE`, `INVALID_UPLOAD`, `UNSUPPORTED_FILE_TYPE`, `FILE_NOT_FOUND`, `INVALID_IDEMPOTENCY_KEY`, `IDEMPOTENCY_KEY_REUSED`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`, `IDEMPOTENCY_UNAVAILABLE`, `RESOURCE_ALREADY_EXISTS`, `DATABASE_ERROR`, `DEPENDENCY_UNAVAILABLE`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`.

## Error Handling

Errors flow one way: code **throws**, and a single middleware (`src/shared/middlewares/error.middleware.ts`, registered last in `app.ts`) turns every error into the standard error response. Controllers and services never build error responses themselves.

```
service / middleware ──throw──▶ Express 5 (sync throw or rejected promise) ──▶ errorMiddleware ──▶ { message, errorCode, details? }
```

1. **Expected errors**: throw `HttpError` (`src/shared/errors/http-error.ts`) with a status and a stable `errorCode`:

   ```ts
   throw HttpError.notFound("User not found", { errorCode: "USER_NOT_FOUND" });
   ```

   Factories: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `serviceUnavailable`; use `new HttpError(message, { statusCode })` for anything else.

2. **No try/catch for forwarding.** Express 5 sends both synchronous throws and rejected promises from handlers to the error middleware. Catch only to _translate_ an error (e.g. `TokenService.verifyAccessToken` turns JWT errors into 401 `HttpError`s, `validate` turns `ZodError` into 400 `VALIDATION_ERROR`) or to degrade on purpose (cache misses, best-effort emails).

3. **The error middleware** checks, in order:

   | Error                                       | Response                                                                                                               |
   | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | Response already started (e.g. a download)  | Logged and handed to Express, which closes the connection                                                              |
   | `ZodError` (thrown outside `validate`)      | 400 `VALIDATION_ERROR` with `[{ path, message }]`, same shape as `validate`                                            |
   | `HttpError`                                 | its status, message, `errorCode`, `details`                                                                            |
   | `MulterError`                               | 413 `FILE_TOO_LARGE`, otherwise 400 `INVALID_UPLOAD`                                                                   |
   | 4xx from Express middleware (`http-errors`) | that status, e.g. 400 malformed JSON, 413 body too large                                                               |
   | Duplicate key (`ER_DUP_ENTRY`)              | 409 `RESOURCE_ALREADY_EXISTS` (safety net for races)                                                                   |
   | `DrizzleQueryError`                         | 500 "Internal Server Error" + `DATABASE_ERROR`, logged without query params                                            |
   | anything else                               | 500 "Internal Server Error" + `INTERNAL_SERVER_ERROR`, logged; the stack is added as `details` only outside production |

   Only the last two are logged as errors: 4xx responses are expected and already appear in the request log.

4. **Every log line carries the request id** (also returned as `X-Request-Id`), so a client-reported error can be traced to its log entry.

5. **Process-level failures** live in `server.ts`: `unhandledRejection` triggers a graceful shutdown, `uncaughtException` exits immediately (state may be corrupt), and a failing `listen` (e.g. port in use) exits with code 1.

## Testing

Integration tests run against a real MySQL: start it with `docker compose up -d mysql`. Each Vitest worker creates and migrates its own database (`app_test_<n>`, from `TEST_DATABASE_URL`, default `mysql://root:root@127.0.0.1:3306/app_test`) and every `createTestApp()` empties it, so tests start clean and files run in parallel.

Tests use in-memory replacements for Redis-backed services (`MemoryCache`, `RecordingJobQueue` to assert queued jobs) and a temporary upload directory. The Redis cache suite runs against a real Redis when `TEST_REDIS_URL` is set:

```bash
TEST_REDIS_URL=redis://127.0.0.1:6379/15 npm test
```

## Scaling Notes

- Run several API instances behind a load balancer only with `REDIS_URL` set (shared rate limits, cache and idempotency) and a shared `FileStorage` (implement it for S3/GCS; `LocalFileStorage` is per machine).
- Run as many workers as the job load needs; BullMQ distributes jobs between them.
- Set `TRUST_PROXY` to the number of proxies in front of the app so rate limits and audit IPs see the real client.

## Dependency Security Notes

- `esbuild` under `@esbuild-kit/core-utils` is overridden to `^0.25.12` (see `overrides` in `package.json`) because `drizzle-kit` still pulls in the vulnerable `esbuild@0.18` (GHSA-67mh-4wv8-2f99) through its legacy `@esbuild-kit/esm-loader` dependency. Remove the override once `drizzle-kit` drops that dependency.
- Re-check periodically with `npm audit` (CI fails on high-severity findings).
