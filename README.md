# boilerplate-express

REST API boilerplate built with **Express 5 + TypeScript + Drizzle ORM (SQLite via better-sqlite3)**. Code is organized by feature module, each layered as routes → controller → service → repository, with constructor-based dependency injection wired from a single composition root.

## Features

- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Environment validation** at startup with Zod (`src/config/env.ts`) — the app refuses to start if env is invalid
- **App factory + composition root** — `createApp({ db, config })` builds the app without listening; `server.ts` creates the real dependencies, tests inject an in-memory database and can override any config value. Modules declare their own dependencies and are wired once in `routes.ts`
- **Request validation** (body / params / query) with Zod via the `validate` middleware, typed from the schemas
- **Native async error handling** (Express 5) — async handlers need no wrapper; rejected promises reach the error middleware
- **Consistent response format** via `sendSuccess` / `sendPaginated` / `sendError` (`src/shared/http/response.ts`), which set the HTTP status and echo it as `statusCode` in the body, and `HttpError` (`src/shared/errors/http-error.ts`)
- **Centralized error handler** — handles `ZodError`, `HttpError`, database errors (UNIQUE constraint → 409), and unexpected errors (stack traces only shown outside production)
- **Security**: `helmet`, CORS allowlist (`*` rejected in production), per-IP rate limit, `trust proxy` off by default, JSON-only body capped at 100kb, malformed/oversized bodies answered with 400/413
- **Request IDs**: every response carries `X-Request-Id` (a safe incoming value is reused), and it is included in request and error logs
- **Logging**: JSON logs with Winston + request logger (request id, method, path without query string, status, duration)
- **Health checks**: `/api/health/live` (process up) and `/api/health/ready` (database reachable, 503 otherwise)
- **Graceful shutdown** (SIGINT/SIGTERM) that drains in-flight requests, closes idle keep-alive sockets and the database, and force-exits after 10s
- **Authentication**: register/login with Argon2id password hashing (OWASP parameters, automatic rehash on login), short-lived HS256 JWT access tokens with a pinned algorithm, rotating refresh tokens (stored hashed, reuse revokes the session), logout, stricter rate limit on credential endpoints, and identical responses for unknown email vs. wrong password
- **Authorization**: `user` / `admin` roles, `requireRole(...)` middleware and `assertOwnerOrRole(...)` for owner-or-admin access
- **API docs**: OpenAPI 3.1 generated from the Zod schemas, with Swagger UI at `/api/docs` (disabled in production)
- **Tests**: Vitest + Supertest integration tests against a migrated in-memory SQLite database, plus service unit tests with a fake repository
- **Tooling**: ESLint (typescript-eslint) + Prettier, LF line endings enforced via `.gitattributes`, GitHub Actions CI on Node 22 and 24

## Prerequisites

- Node.js 22.12+ (see `engines`; tested on Node 24, `.nvmrc` pins 24)
- npm

## Getting Started

```bash
npm install
cp .env.example .env
# set JWT_SECRET in .env (at least 32 chars), e.g.:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
npm run db:migrate        # creates the SQLite database and applies migrations
npm run dev               # http://localhost:3000, docs at /api/docs

# optional: make a registered user an admin
npm run user:make-admin -- you@example.com
```

## Environment Variables

| Variable                    | Default      | Description                                                                                                             |
| --------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                  | — (required) | `development` \| `test` \| `production`. Required so a server never silently falls back to dev error output             |
| `PORT`                      | `3000`       | HTTP port                                                                                                               |
| `CORS_ORIGIN`               | `*`          | Comma-separated origins, e.g. `https://a.com,https://b.com`. `*` = allow all (not allowed in production)                |
| `TRUST_PROXY`               | `0`          | Number of reverse proxies in front of the app. Set it to the real hop count; a higher value lets clients spoof their IP |
| `RATE_LIMIT_MAX`            | `100`        | Max requests per IP per minute (in-memory, per process)                                                                 |
| `DATABASE_URL`              | `dev.db`     | SQLite database file path (relative to the project root)                                                                |
| `JWT_SECRET`                | — (required) | HS256 signing key, at least 32 characters. Rotating it invalidates every issued token                                   |
| `JWT_TTL_SECONDS`           | `900`        | Access token lifetime in seconds                                                                                        |
| `REFRESH_TOKEN_TTL_SECONDS` | `2592000`    | Refresh token lifetime in seconds (30 days)                                                                             |

## Scripts

| Script                               | Description                                                                   |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `npm run dev`                        | Start the dev server with auto-reload (tsx)                                   |
| `npm run build`                      | Compile TypeScript to `dist/` (tests excluded)                                |
| `npm start`                          | Run the compiled build (`dist/server.js`)                                     |
| `npm run typecheck`                  | Type-check everything, including tests                                        |
| `npm test`                           | Run the test suite once (Vitest)                                              |
| `npm run test:watch`                 | Run tests in watch mode                                                       |
| `npm run db:generate`                | Generate a SQL migration from the schema                                      |
| `npm run db:migrate`                 | Apply pending migrations                                                      |
| `npm run db:studio`                  | Open Drizzle Studio                                                           |
| `npm run lint` / `lint:fix`          | ESLint                                                                        |
| `npm run format` / `format:check`    | Prettier                                                                      |
| `npm run user:make-admin -- <email>` | Promote a user to admin (`node dist/cli/make-admin.js <email>` after a build) |

## Project Structure

```
drizzle/                     # generated SQL migrations (commit these)
drizzle.config.ts            # drizzle-kit config
vitest.config.mts            # test config (test env vars live here)
eslint.config.mjs            # lint rules
.github/workflows/ci.yml     # format, lint, typecheck, test, build, audit
src/
  server.ts                  # composition root: creates the DB, listens, graceful shutdown
  app.ts                     # createApp({ db, config }): global middleware + routes, no listen
  routes.ts                  # builds and wires every feature module, mounts them under /api
  cli/make-admin.ts          # promote a user to admin
  docs/                      # OpenAPI document + Swagger UI router
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
    authentication/          # register, login, refresh, logout, profile, tokens, authenticate + authorize, argon2
    health/                  # liveness + readiness
    users/                   # example CRUD module backed by Drizzle
  test/
    create-test-app.ts       # app + migrated in-memory DB for tests
```

### Module anatomy

Each module lives in `src/modules/<name>/` and consists of:

| File              | Responsibility                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `*.schema.ts`     | Zod request schemas + DTO types inferred with `z.infer`                                                                          |
| `*.routes.ts`     | Route definitions: `validate(...)` followed by the controller handler                                                            |
| `*.controller.ts` | HTTP concerns only: read the request, call the service, send the response                                                        |
| `*.service.ts`    | Business rules; throws `HttpError` for domain cases (not found, conflict)                                                        |
| `*.repository.ts` | Repository interface + Drizzle implementation (the only layer touching the DB)                                                   |
| `*.entity.ts`     | Internal data types                                                                                                              |
| `*.mapper.ts`     | Entity → response DTO (the place to strip sensitive fields)                                                                      |
| `*.module.ts`     | `create<Name>Module(deps)`: declares its dependencies, wires repository → service → controller, returns `{ router, ...exports }` |
| `*.test.ts`       | Integration tests (Supertest) and unit tests next to the code they cover                                                         |

### Adding a new module

1. Add the table to `src/db/schema.ts`, then run `npm run db:generate` and `npm run db:migrate`.
2. Create `src/modules/<name>/` following the `users` module pattern.
3. Build and mount it in `src/routes.ts`, passing only what it needs (including other modules' exports):

   ```ts
   const products = createProductModule({
     db,
     authenticate,
     userService: users.service,
   });
   router.use("/products", products.router);
   ```

4. Protect routes with the injected `authenticate` middleware (`router.use(authenticate)` or per route), restrict them with `requireRole("admin")` or `assertOwnerOrRole(getAuth(res), ownerId, "admin")`, and read the caller with `getAuth(res)`.
5. Document the routes in `src/docs/openapi.ts` (reuse the module's Zod schemas).
6. If the module needs new infrastructure (cache, queue, ...), add it to `AppDependencies` in `src/app.ts` and create it in `server.ts` and `src/test/create-test-app.ts`.

## API

Base URL: `/api`

| Method | Endpoint                   | Description                                                                                              |
| ------ | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| GET    | `/health/live`             | Liveness: process is up (uptime, timestamp)                                                              |
| GET    | `/health/ready`            | Readiness: database reachable, otherwise 503                                                             |
| POST   | `/authentication/register` | Create an account (body: `name` 2–100 chars, `email`, `password` 8–128 chars); returns the user + tokens |
| POST   | `/authentication/login`    | Exchange email + password for tokens                                                                     |
| POST   | `/authentication/refresh`  | Exchange a refresh token for a new token pair (the old one stops working)                                |
| POST   | `/authentication/logout`   | End the session a refresh token belongs to                                                               |
| GET    | `/authentication/profile`  | 🔒 Current user profile                                                                                  |
| GET    | `/users`                   | 🔒 Admin only. List users (query: `page` ≥ 1, `limit` 1–100)                                             |
| GET    | `/users/:id`               | 🔒 Owner or admin. Get a user (`id` must be a UUID)                                                      |
| GET    | `/docs`                    | Swagger UI; raw spec at `/docs/openapi.json` (not served in production)                                  |

🔒 = requires `Authorization: Bearer <accessToken>`. `register`, `login` and `refresh` share a stricter limiter: 10 failed attempts per IP per 15 minutes.

### Tokens and roles

- **Access token**: HS256 JWT, `sub` = user id plus a `role` claim, valid for `JWT_TTL_SECONDS` (15 min). Stateless, so a role change takes effect on the next refresh or login.
- **Refresh token**: random 256-bit string, stored only as a SHA-256 hash, valid for `REFRESH_TOKEN_TTL_SECONDS` (30 days). Each refresh returns a new pair and retires the old token. Presenting a retired token means it leaked, so every token of that session is revoked. Each login starts its own session, so logging out on one device keeps the others.
- **Roles**: `user` (default for every registration) and `admin`. There is no API to grant roles; promote the first admin with `npm run user:make-admin -- <email>`.
- Tokens are returned in the JSON body. Browser clients should keep the refresh token out of reach of scripts (e.g. move it to an `HttpOnly` cookie at a BFF/proxy).

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

Error codes in use: `VALIDATION_ERROR`, `BAD_REQUEST` (malformed JSON), `REQUEST_ENTITY_TOO_LARGE`, `ROUTE_NOT_FOUND`, `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `FORBIDDEN`, `USER_NOT_FOUND`, `EMAIL_ALREADY_EXISTS`, `RESOURCE_ALREADY_EXISTS`, `DATABASE_ERROR`, `DATABASE_UNAVAILABLE`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`.

## Error Handling

Errors flow one way: code **throws**, and a single middleware (`src/shared/middlewares/error.middleware.ts`, registered last in `app.ts`) turns every error into the standard error response. Controllers and services never build error responses themselves.

```
service / middleware ──throw──▶ Express 5 (sync throw or rejected promise) ──▶ errorMiddleware ──▶ { message, errorCode, details? }
```

1. **Expected errors** — throw `HttpError` (`src/shared/errors/http-error.ts`) with a status and a stable `errorCode`:

   ```ts
   throw HttpError.notFound("User not found", { errorCode: "USER_NOT_FOUND" });
   ```

   Factories: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`, `serviceUnavailable`; use `new HttpError(message, { statusCode })` for anything else.

2. **No try/catch for forwarding.** Express 5 sends both synchronous throws and rejected promises from handlers to the error middleware. Catch only to _translate_ an error (e.g. `TokenService.verifyAccessToken` turns JWT errors into 401 `HttpError`s, `validate` turns `ZodError` into 400 `VALIDATION_ERROR`).

3. **The error middleware** checks, in order:

   | Error                                       | Response                                                                                                               |
   | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
   | `ZodError` (thrown outside `validate`)      | 400 `VALIDATION_ERROR` with `[{ path, message }]`, same shape as `validate`                                            |
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
- `better-sqlite3` is pinned to `^12`: v13 ships prebuilt binaries but npm still runs `node-gyp rebuild` when installing it from the lockfile (`npm ci`), which fails on machines without Python and a C++ toolchain. v12 downloads its prebuilt binary instead. Re-test `rm -rf node_modules && npm ci` before upgrading.
- Re-check periodically with `npm audit` (CI fails on high-severity findings).
