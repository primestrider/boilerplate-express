# boilerplate-express

REST API boilerplate built with **Express 4 + TypeScript + Prisma (SQLite)**, using a layered modular architecture (routes → controller → service → repository) with manual dependency injection.

## Features

- **Strict TypeScript** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Environment validation** at startup with Zod (`src/config/env.ts`) — the app refuses to start if env is invalid
- **Request validation** (body / params / query) with Zod via the `validate` middleware
- **Consistent response format** via `responseFormatter` + `HttpError` (`src/libs/response.ts`)
- **Centralized error handler** — handles `ZodError`, `HttpError`, Prisma errors (P2002 → 409), and unexpected errors (stack traces only shown outside production)
- **Security**: `helmet`, CORS allowlist, global rate limit, configurable `trust proxy`
- **Logging**: JSON logs with Winston + request logger (method, path, status, duration)
- **Graceful shutdown** (SIGINT/SIGTERM) that closes the server and the Prisma connection

## Prerequisites

- Node.js 20+ (tested on Node 24)
- npm

## Getting Started

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate    # creates the SQLite database + initial migration
npm run dev               # http://localhost:3000
```

## Environment Variables

| Variable       | Default         | Description                                                                   |
| -------------- | --------------- | ----------------------------------------------------------------------------- |
| `NODE_ENV`     | `development`   | `development` \| `test` \| `production`                                       |
| `PORT`         | `3000`          | HTTP port                                                                     |
| `CORS_ORIGIN`  | `*`             | Comma-separated origins, e.g. `https://a.com,https://b.com`. `*` = allow all |
| `TRUST_PROXY`  | `1`             | Number of trusted proxy hops (`0` if not behind a proxy)                      |
| `DATABASE_URL` | `file:./dev.db` | Prisma connection string (relative paths resolve from `prisma/`)              |

## Scripts

| Script                    | Description                                 |
| ------------------------- | ------------------------------------------- |
| `npm run dev`             | Start the dev server with auto-reload (tsx) |
| `npm run build`           | Compile TypeScript to `dist/`               |
| `npm start`               | Run the compiled build (`dist/server.js`)   |
| `npm test`                | Run Jest                                    |
| `npm run prisma:generate` | Generate Prisma Client                      |
| `npm run prisma:migrate`  | Create & apply migrations (dev)             |
| `npm run prisma:studio`   | Open Prisma Studio                          |

## Project Structure

```
prisma/
  schema.prisma              # database schema
src/
  server.ts                  # entry point: listen, graceful shutdown
  app.ts                     # express setup + global middleware
  routes.ts                  # registers all modules under /api
  config/                    # env, logger, cors, rate limit
  libs/
    prisma.ts                # shared PrismaClient instance
    response.ts              # responseFormatter + HttpError
  middlewares/               # async handler, validate, error, 404, request logger
  modules/
    health/                  # example module without a database
    users/                   # example CRUD module backed by Prisma
```

### Module anatomy

Each module lives in `src/modules/<name>/` and consists of:

| File              | Responsibility                                                                  |
| ----------------- | ------------------------------------------------------------------------------- |
| `*.validation.ts` | Zod schemas + DTO types inferred with `z.infer`                                 |
| `*.routes.ts`     | Route definitions, wiring `validate(...)` and `asyncHandler(...)`               |
| `*.controller.ts` | HTTP concerns only: read the request, call the service, send the response      |
| `*.service.ts`    | Business rules; throws `HttpError` for domain cases (not found, conflict)       |
| `*.repository.ts` | Repository interface + Prisma implementation (the only layer touching the DB)  |
| `*.entity.ts`     | Internal data types                                                             |
| `*.mapper.ts`     | Entity → response DTO (the place to strip sensitive fields)                     |
| `*.module.ts`     | Factory that wires repository → service → controller → router                   |

### Adding a new module

1. Add the model to `prisma/schema.prisma`, then run `npm run prisma:migrate`.
2. Create `src/modules/<name>/` following the `users` module pattern.
3. Register the router in `src/routes.ts`:

   ```ts
   const productModule = createProductModule();
   routes.use("/products", productModule.router);
   ```

## API

Base URL: `/api`

| Method | Endpoint     | Description                                         |
| ------ | ------------ | --------------------------------------------------- |
| GET    | `/health`    | Service status, uptime, timestamp                   |
| GET    | `/users`     | List users (query: `page` ≥ 1, `limit` 1–100)       |
| GET    | `/users/:id` | Get a user (`id` must be a UUID)                    |
| POST   | `/users`     | Create a user (body: `name` 2–100 chars, `email`)   |

### Response format

Success or failure is expressed by the **HTTP status code**, so response bodies have no `success` field.

Success:

```json
{ "message": "User created successfully", "data": { "id": "...", "name": "Ricky", "email": "r@x.com" } }
```

Paginated:

```json
{
  "message": "Users retrieved successfully",
  "data": [],
  "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
}
```

Error:

```json
{
  "message": "Validation error",
  "errorCode": "VALIDATION_ERROR",
  "details": [{ "path": "email", "message": "Invalid email address" }]
}
```

Error codes in use: `VALIDATION_ERROR`, `USER_NOT_FOUND`, `EMAIL_ALREADY_EXISTS`, `RESOURCE_ALREADY_EXISTS`, `DATABASE_ERROR`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`.

## Dependency Security Notes

- `deepmerge-ts` is overridden to `^8` (see `overrides` in `package.json`) because Prisma 6 still ships the vulnerable v7 (GHSA-ggr8-5vv4-36mx). Remove the override once a stable Prisma release depends on `deepmerge-ts` ≥ 8.
- Re-check periodically with `npm audit`.
