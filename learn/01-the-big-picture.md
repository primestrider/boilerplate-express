# 01 · The Big Picture

## Goals

By the end of this chapter you will:

- know what a "backend" is and what it is responsible for,
- be able to follow one HTTP request from the moment it reaches this app until the response leaves,
- know what every folder in `src/` is for,
- understand how `server.ts`, `app.ts` and `routes.ts` fit together,
- know what changes when Redis is (or is not) configured, and why there is a separate worker process.

## Core concepts

### What is a backend?

Think of a restaurant.

- The **client** (a browser, a mobile app, another server) is the customer. It asks for things.
- The **backend** is the kitchen. Customers never walk into it; they place orders through a waiter and get a plate back.
- The **API** (Application Programming Interface) is the menu plus the waiter: the list of things you can order and the agreed way to order them.
- The **database** is the pantry: where ingredients (data) are stored between orders.

A backend's job is to:

1. **Receive requests** over the network (usually HTTP).
2. **Check them**: is the request well-formed? Who is asking? Are they allowed to?
3. **Do the work**: read or change data, call other services, schedule slow tasks.
4. **Answer** with a response in a predictable format.
5. Do all of this **safely, reliably and observably** (you can see what happened when something goes wrong).

Most of this boilerplate is about point 5. Receiving a request and answering it takes about ten lines of Express; the remaining code exists so the app stays correct when users send bad data, attackers probe it, the database is slow, Redis is down or two requests race each other.

### Client and server

```
┌──────────┐   HTTP request   ┌────────────────────┐   SQL    ┌─────────┐
│  Client  │ ───────────────▶ │  This API (server) │ ───────▶ │  MySQL  │
│ (browser,│ ◀─────────────── │  Express + Node.js │ ◀─────── │         │
│  app...) │   HTTP response  └─────────┬──────────┘          └─────────┘
└──────────┘                            │ cache, rate limits, jobs
                                        ▼
                                   ┌─────────┐   jobs   ┌──────────┐
                                   │  Redis  │ ───────▶ │  Worker  │ ──▶ email (SMTP)
                                   └─────────┘          └──────────┘
```

- **Node.js** runs JavaScript on a server.
- **Express** is a small library that turns incoming HTTP requests into calls to your functions.
- **MySQL** stores the permanent data (users, refresh tokens, files' metadata, audit log).
- **Redis** is an optional, very fast in-memory store used for caching, shared rate-limit counters, idempotency records and the job queue.
- The **worker** is a second Node.js process that runs background jobs (for example sending email) so the API does not have to wait for them.

## In this boilerplate

### The three entry files

| File            | Role                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server.ts` | **Starts the process.** Creates the real database pool, Redis client, cache, job queue and file storage, then calls `createApp(...)` and `listen`. Handles graceful shutdown. |
| `src/app.ts`    | **Builds the Express app** (global middleware, the `/api` router, error handling) **without** listening on a port.                                                            |
| `src/routes.ts` | **Wires the feature modules together** and mounts them under `/api` and `/api/v1`.                                                                                            |

This split is called a **composition root**: one place (here `server.ts` plus `routes.ts`) decides which concrete objects are created and passed to whom. Everything else just receives what it needs.

Why not create the database connection inside the users module? Because then tests could not swap it for a test database, and two modules could accidentally create two connection pools. Look at the type that `createApp` receives:

```ts
// src/app.ts
export type AppDependencies = {
  db: DB;
  config: Env;
  /** Shared rate-limit counters and readiness check; optional. */
  redis: Redis | undefined;
  cache: Cache;
  jobQueue: JobQueue;
  storage: FileStorage;
};
```

`server.ts` passes the real things; the tests (`src/test/create-test-app.ts`) pass a test database and in-memory replacements. The app code does not know or care which one it got.

### Map of `src/`

```
src/
  server.ts          process entry point: creates real dependencies, listens, shuts down gracefully
  worker.ts          second entry point: processes background jobs from Redis (BullMQ)
  app.ts             createApp(deps): global middleware + routes, no listen
  routes.ts          builds every module and mounts them (/api/health, /api/v1/..., /api/docs)
  cli/               command-line scripts (make-admin)
  config/            env validation, logger, CORS options, rate limiters
  db/                database connection, table schema, migrations runner, DB error helpers
  docs/              OpenAPI document and Swagger UI router
  jobs/              background job definitions and queues
  shared/            code used by many modules
    cache/             Cache interface + Redis and in-memory implementations
    context/           per-request context (request id, IP, user) via AsyncLocalStorage
    errors/            HttpError, the "expected error" class
    http/              response helpers (sendSuccess...) and pagination
    mail/              Mailer (nodemailer)
    middlewares/       validate, error handler, 404, request id, request logger, idempotency
    storage/           FileStorage interface + local disk implementation
  modules/           one folder per feature
    audit/             audit log (record + admin listing)
    authentication/    register, login, refresh, logout, change password, tokens
    files/             upload, list, download, delete
    health/            liveness and readiness checks
    users/             user CRUD, roles, soft delete, cache
  test/              helpers to build an app for tests
```

The rule of thumb: **`modules/` is about features, `shared/` is about plumbing.** A module may use `shared/`, but `shared/` never imports from a module. (The idempotency middleware does read `res.locals.auth`, but through Express's global `Locals` type, not through an import.)

## Step by step: the life of one request

Let us follow `GET /api/v1/users/<id>` with an `Authorization` header. Every arrow is a function call; each box is a **middleware**, a function that sees the request before the next one does (chapter 3 explains middleware in depth).

```
Client
  │  GET /api/v1/users/7c1e... + Authorization: Bearer eyJ...
  ▼
┌─────────────────────────── src/app.ts (global, every request) ───────────────────────────┐
│ 1. requestIdMiddleware      give the request an id, echo it as X-Request-Id,             │
│                             open the request context                                    │
│ 2. requestLoggerMiddleware  remember the start time; log when the response finishes     │
│ 3. helmet()                 add security headers                                        │
│ 4. cors(...)                add CORS headers for allowed browser origins                │
│ 5. global rate limiter      too many requests from this IP? → 429                       │
│ 6. compression()            gzip/brotli the response if it is big and the client agrees │
│ 7. express.json()           parse a JSON body (max 100kb)                               │
│ 8. app.use("/api", ...)     hand over to the API router                                 │
└───────────────────────────────────────────┬──────────────────────────────────────────────┘
                                            ▼
┌──────────────────────── src/routes.ts → users module ───────────────────────────┐
│ 9.  "/v1" router → "/users" router                                              │
│ 10. authenticate            verify the JWT → res.locals.auth = { userId, role } │
│ 11. validate({ params })    is :id a UUID? → otherwise 400                      │
│ 12. userController.findById owner or admin? call the service, send the response │
│       └─ userService.findById → CachedUserRepository → (Redis or MySQL)         │
└───────────────────────────────────────────┬─────────────────────────────────────┘
                                            ▼
               response sent ─────▶ request logger writes one log line

   If no route matched:      notFoundMiddleware  → 404 ROUTE_NOT_FOUND
   If anything threw:        error middleware    → standard error JSON
```

The two last middlewares in `app.ts` are the safety net:

```ts
// src/app.ts
app.use("/api", createRoutes(dependencies));

app.use(notFoundMiddleware);
// Must be registered last.
app.use(
  createErrorMiddleware({ exposeStack: config.NODE_ENV !== "production" }),
);
```

- If no route answered, the request falls through to `notFoundMiddleware`, which answers 404.
- If any step **threw an error** (for example "user not found", "invalid token" or a database failure), Express skips the remaining normal middleware and jumps to the error middleware, which turns the error into a JSON response. Chapter 5 covers this.

### How Redis changes the runtime

Redis is **optional**. `server.ts` decides what to build:

```ts
// src/server.ts
const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 1000 })
  : undefined;

const cache: Cache = redis ? new RedisCache(redis) : new MemoryCache();
const jobQueue: JobQueue = redis
  ? new BullJobQueue(redis)
  : new InlineJobQueue(
      createJobHandlers({ mailer: new NodemailerMailer(env) }),
    );
```

| Concern             | With `REDIS_URL`                               | Without `REDIS_URL`                                |
| ------------------- | ---------------------------------------------- | -------------------------------------------------- |
| User cache          | Shared by every API instance (`RedisCache`)    | Per process (`MemoryCache`)                        |
| Rate-limit counts   | Shared (`rate-limit-redis` store)              | Per process (default in-memory store)              |
| Idempotency records | Shared                                         | Per process                                        |
| Background jobs     | Stored in Redis, run by the **worker** process | Run inside the API process right after the request |
| Readiness check     | Checks the database **and** Redis              | Checks the database only                           |

Without Redis everything still works, which is perfect for local development with a single process. With several API instances behind a load balancer, Redis is required, otherwise each instance would have its own counters and caches (chapter 17).

### The separate worker process

`src/worker.ts` is a second program. It connects to Redis, waits for jobs (like "send this email") and runs them. Why a separate process?

- Sending email can take seconds or fail; the user should not wait for it.
- If the email server is down, the job is **retried** later with backoff, even if the API restarts.
- You can run more workers when there is more work, independently of the API.

You start it with `npm run worker` (development) or `node dist/worker.js` (production). Chapter 12 covers it.

## Try it yourself

Start the dependencies and the API (see `learn/README.md`), then:

```bash
# 1. Liveness: is the process up?
curl -s http://localhost:3000/api/health/live
# {"statusCode":200,"data":{"status":"OK","uptime":12.3,"timestamp":"..."}}

# 2. Readiness: can it serve traffic (database, and Redis if configured)?
curl -s http://localhost:3000/api/health/ready
# {"statusCode":200,"data":{"status":"OK",...,"checks":{"database":"up","redis":"up"}}}

# 3. See the request id and security headers added by the global middleware
curl -s -D - -o /dev/null http://localhost:3000/api/health/live
# X-Request-Id: 3f0c...            ← requestIdMiddleware
# X-Content-Type-Options: nosniff  ← helmet
# RateLimit-Policy: 100;w=60       ← global rate limiter

# 4. A route that does not exist goes all the way to notFoundMiddleware
curl -s http://localhost:3000/api/nope
# {"statusCode":404,"message":"Route GET /api/nope not found","errorCode":"ROUTE_NOT_FOUND"}
```

Now look at the terminal running `npm run dev`: each request produced one JSON log line with the same request id you saw in the header.

Optional: stop Redis (`docker compose stop redis`), call `/api/health/ready` again, and you get a `503` naming `redis` as down, while `/api/health/live` still answers `200`. Start it again with `docker compose start redis`.

## Common mistakes

- **Creating connections inside modules.** It feels convenient, but it makes testing hard and can create many connection pools. Here, only `server.ts` (and `worker.ts`, the CLI and the migration script, which are separate programs) create connections.
- **Calling `listen` inside the app factory.** Tests then cannot build an app without opening a port. `createApp` returns the app; only `server.ts` listens.
- **Doing slow work inside the request.** Sending email synchronously makes the user wait and fails the request when the mail server hiccups. Use a job.
- **Assuming one process.** In-memory state (caches, counters) silently breaks once you run two instances. That is why those concerns go through interfaces that can be backed by Redis.

## Summary

- A backend receives requests, checks them, does the work and answers, safely and observably.
- `server.ts` creates the real dependencies, `app.ts` assembles the Express app, `routes.ts` wires the feature modules: together they are the composition root.
- Every request passes through the same global middleware chain in `app.ts`, then a module's routes, and ends at either a response, the 404 handler or the error handler.
- Redis is optional: it makes caching, rate limits, idempotency and jobs shared across processes; without it, everything runs in one process.
- The worker is a separate process that runs background jobs from Redis.

Next: [02 · HTTP and REST APIs](02-http-and-rest.md)
