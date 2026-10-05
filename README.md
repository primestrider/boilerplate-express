# boilerplate-express

REST API boilerplate built with **Express 5 + TypeScript + Drizzle ORM (SQLite via better-sqlite3)**. Code is organized by feature module, each layered as routes → controller → service → repository, with constructor-based dependency injection wired from a single composition root.

## Features

- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Environment validation** at startup with Zod (`src/config/env.ts`) — the app refuses to start if env is invalid
- **App factory + composition root** — `createApp({ db })` builds the app without listening; `server.ts` creates the real dependencies, tests inject an in-memory database
- **Request validation** (body / params / query) with Zod via the `validate` middleware, typed from the schemas
- **Native async error handling** (Express 5) — async handlers need no wrapper; rejected promises reach the error middleware
- **Consistent response format** via `sendSuccess` / `sendPaginated` / `sendError` (`src/shared/http/response.ts`), which set the HTTP status and echo it as `statusCode` in the body, and `HttpError` (`src/shared/errors/http-error.ts`)
- **Centralized error handler** — handles `ZodError`, `HttpError`, database errors (UNIQUE constraint → 409), and unexpected errors (stack traces only shown outside production)
- **Security**: `helmet`, CORS allowlist (`*` rejected in production), per-IP rate limit, `trust proxy` off by default, JSON-only body capped at 100kb, malformed/oversized bodies answered with 400/413
- **Request IDs**: every response carries `X-Request-Id` (a safe incoming value is reused), and it is included in request and error logs
- **Logging**: JSON logs with Winston + request logger (request id, method, path without query string, status, duration)
- **Health checks**: `/api/health/live` (process up) and `/api/health/ready` (database reachable, 503 otherwise)
- **Graceful shutdown** (SIGINT/SIGTERM) that drains in-flight requests, closes idle keep-alive sockets and the database, and force-exits after 10s
- **Authentication**: register/login with Argon2id password hashing (OWASP parameters, automatic rehash on login), HS256 JWT access tokens with a pinned algorithm, `authenticate` middleware, stricter rate limit on credential endpoints, and identical responses for unknown email vs. wrong password
- **Tests**: Vitest + Supertest integration tests against a migrated in-memory SQLite database, plus service unit tests with a fake repository

## Prerequisites

- Node.js 22+ (required by `better-sqlite3`; tested on Node 24)
- npm

## Getting Started

```bash
npm install
cp .env.example .env
# set JWT_SECRET in .env (at least 32 chars), e.g.:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm run db:migrate        # creates the SQLite database and applies migrations
npm run dev               # http://localhost:3000
```

## Environment Variables

| Variable          | Default      | Description                                                                                                             |
| ----------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`        | — (required) | `development` \| `test` \| `production`. Required so a server never silently falls back to dev error output             |
| `PORT`            | `3000`       | HTTP port                                                                                                               |
| `CORS_ORIGIN`     | `*`          | Comma-separated origins, e.g. `https://a.com,https://b.com`. `*` = allow all (not allowed in production)                |
| `TRUST_PROXY`     | `0`          | Number of reverse proxies in front of the app. Set it to the real hop count; a higher value lets clients spoof their IP |
| `RATE_LIMIT_MAX`  | `100`        | Max requests per IP per minute (in-memory, per process)                                                                 |
| `DATABASE_URL`    | `dev.db`     | SQLite database file path (relative to the project root)                                                                |
| `JWT_SECRET`      | — (required) | HS256 signing key, at least 32 characters. Rotating it invalidates every issued token                                   |
| `JWT_TTL_SECONDS` | `900`        | Access token lifetime in seconds                                                                                        |

## Scripts

| Script                | Description                                    |
| --------------------- | ---------------------------------------------- |
| `npm run dev`         | Start the dev server with auto-reload (tsx)    |
| `npm run build`       | Compile TypeScript to `dist/` (tests excluded) |
| `npm start`           | Run the compiled build (`dist/server.js`)      |
| `npm run typecheck`   | Type-check everything, including tests         |
| `npm test`            | Run the test suite once (Vitest)               |
| `npm run test:watch`  | Run tests in watch mode                        |
| `npm run db:generate` | Generate a SQL migration from the schema       |
| `npm run db:migrate`  | Apply pending migrations                       |
| `npm run db:studio`   | Open Drizzle Studio                            |

## Project Structure

```
drizzle/                     # generated SQL migrations (commit these)
drizzle.config.ts            # drizzle-kit config
vitest.config.mts            # test config (test env vars live here)
src/
  server.ts                  # composition root: creates the DB, listens, graceful shutdown
  app.ts                     # createApp({ db }): global middleware + routes, no listen
  routes.ts                  # mounts every feature module under /api
  config/                    # env, logger, cors, rate limit
  db/
    index.ts                 # createDatabase(url) + DB type
    schema.ts                # Drizzle table definitions
    errors.ts                # driver error helpers (unique violation)
  shared/
    errors/http-error.ts     # HttpError
    http/response.ts         # sendSuccess / sendPaginated / sendError
    middlewares/             # validate, error, 404, request id, request logger
  modules/
    authentication/          # register, login, profile, token service, authenticate middleware, argon2
    health/                  # liveness + readiness
    users/                   # example CRUD module backed by Drizzle
  test/
    create-test-app.ts       # app + migrated in-memory DB for tests
```

### Module anatomy

Each module lives in `src/modules/<name>/` and consists of:

| File              | Responsibility                                                                          |
| ----------------- | --------------------------------------------------------------------------------------- |
| `*.schema.ts`     | Zod request schemas + DTO types inferred with `z.infer`                                 |
| `*.routes.ts`     | Route definitions: `validate(...)` followed by the controller handler                   |
| `*.controller.ts` | HTTP concerns only: read the request, call the service, send the response               |
| `*.service.ts`    | Business rules; throws `HttpError` for domain cases (not found, conflict)               |
| `*.repository.ts` | Repository interface + Drizzle implementation (the only layer touching the DB)          |
| `*.entity.ts`     | Internal data types                                                                     |
| `*.mapper.ts`     | Entity → response DTO (the place to strip sensitive fields)                             |
| `*.module.ts`     | `create<Name>Module(deps)`: wires repository → service → controller, returns the router |
| `*.test.ts`       | Integration tests (Supertest) and unit tests next to the code they cover                |

### Adding a new module

1. Add the table to `src/db/schema.ts`, then run `npm run db:generate` and `npm run db:migrate`.
2. Create `src/modules/<name>/` following the `users` module pattern.
3. Mount it in `src/routes.ts`:

   ```ts
   router.use("/products", createProductModule(deps));
   ```

4. Protect routes with the injected `authenticate` middleware (`router.use(authenticate)` or per route) and read the caller with `getAuth(res).userId`.
5. If the module needs new infrastructure (cache, queue, ...), add it to `AppDependencies` in `src/app.ts`, create it in `server.ts` and in `src/test/create-test-app.ts`. Cross-cutting pieces built from config (like `authenticate`) belong in `ModuleDependencies` in `src/routes.ts`.

## API

Base URL: `/api`

| Method | Endpoint                   | Description                                                                                                    |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| GET    | `/health/live`             | Liveness: process is up (uptime, timestamp)                                                                    |
| GET    | `/health/ready`            | Readiness: database reachable, otherwise 503                                                                   |
| POST   | `/authentication/register` | Create an account (body: `name` 2–100 chars, `email`, `password` 8–128 chars); returns the user + access token |
| POST   | `/authentication/login`    | Exchange email + password for an access token                                                                  |
| GET    | `/authentication/profile`  | 🔒 Current user profile                                                                                        |
| GET    | `/users`                   | 🔒 List users (query: `page` ≥ 1, `limit` 1–100)                                                               |
| GET    | `/users/:id`               | 🔒 Get a user (`id` must be a UUID)                                                                            |

🔒 = requires `Authorization: Bearer <accessToken>`. `/authentication/register` and `/authentication/login` share a stricter limiter: 10 failed attempts per IP per 15 minutes.

### Response format

Every JSON body includes `statusCode`, which always equals the HTTP status of the response (success and error alike). Success or failure is expressed by that status code, so bodies have no `success` field.

Controllers and middleware never call `res.json` directly; they use `sendSuccess`, `sendPaginated` or `sendError`, which set the HTTP status and the body field from one value so the two cannot drift.

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

Error codes in use: `VALIDATION_ERROR`, `BAD_REQUEST` (malformed JSON), `REQUEST_ENTITY_TOO_LARGE`, `ROUTE_NOT_FOUND`, `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `USER_NOT_FOUND`, `EMAIL_ALREADY_EXISTS`, `RESOURCE_ALREADY_EXISTS`, `DATABASE_ERROR`, `DATABASE_UNAVAILABLE`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`.

## Error Handling

Errors flow one way: code **throws**, and a single middleware (`src/shared/middlewares/error.middleware.ts`, registered last in `app.ts`) turns every error into the standard error response. Controllers and services never build error responses themselves.

```
service / middleware ──throw──▶ Express 5 (sync throw or rejected promise) ──▶ errorMiddleware ──▶ { message, errorCode, details? }
```

1. **Expected errors** — throw `HttpError` (`src/shared/errors/http-error.ts`) with a status and a stable `errorCode`:

   ```ts
   throw HttpError.notFound("User not found", { errorCode: "USER_NOT_FOUND" });
   ```

   Factories: `badRequest`, `unauthorized`, `notFound`, `conflict`, `serviceUnavailable`; use `new HttpError(message, { statusCode })` for anything else.

2. **No try/catch for forwarding.** Express 5 sends both synchronous throws and rejected promises from handlers to the error middleware. Catch only to _translate_ an error (e.g. `TokenService.verify` turns JWT errors into 401 `HttpError`s, `validate` turns `ZodError` into 400 `VALIDATION_ERROR`).

3. **The error middleware** checks, in order:

   | Error                                       | Response                                                                                                               |
   | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `ZodError` (thrown outside `validate`)      | 400 `VALIDATION_ERROR` with issues                                                                                     |
   | `HttpError`                                 | its status, message, `errorCode`, `details`                                                                            |
   | 4xx from Express middleware (`http-errors`) | that status, e.g. 400 malformed JSON, 413 body too large                                                               |
   | UNIQUE constraint violation                 | 409 `RESOURCE_ALREADY_EXISTS` (safety net for races)                                                                   |
   | `DrizzleQueryError`                         | 500 "Internal Server Error" + `DATABASE_ERROR`, logged without query params                                            |
   | anything else                               | 500 "Internal Server Error" + `INTERNAL_SERVER_ERROR`, logged; the stack is added as `details` only outside production |

   Only the last two are logged as errors: 4xx responses are expected and already appear in the request log.

4. **Every log line carries the request id** (also returned as `X-Request-Id`), so a client-reported error can be traced to its log entry.

5. **Process-level failures** live in `server.ts`: `unhandledRejection` triggers a graceful shutdown, `uncaughtException` exits immediately (state may be corrupt), and a failing `listen` (e.g. port in use) exits with code 1.

## Dependency Security Notes

- `esbuild` under `@esbuild-kit/core-utils` is overridden to `^0.25.12` (see `overrides` in `package.json`) because `drizzle-kit` still pulls in the vulnerable `esbuild@0.18` (GHSA-67mh-4wv8-2f99) through its legacy `@esbuild-kit/esm-loader` dependency. Remove the override once `drizzle-kit` drops that dependency.
- Re-check periodically with `npm audit`.
