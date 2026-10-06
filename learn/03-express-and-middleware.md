# 03 · Express and Middleware

## Goals

By the end of this chapter you will:

- know what Express is and what `req`, `res` and `next` are,
- have a clear mental model of the **middleware chain**,
- understand how errors (including errors in `async` functions) travel in Express 5,
- be able to explain the order of every middleware in `src/app.ts`,
- know how routers are mounted and what `res.locals` is for,
- be able to write a small middleware yourself.

## Core concepts

### What Express does

Node.js can receive HTTP requests on its own, but its built-in API is low level: you get a stream of bytes and must parse everything yourself. **Express** is a thin layer on top that gives you:

- a `req` (request) object with the method, path, headers, parsed body, route params...,
- a `res` (response) object with helpers like `res.status(...)`, `res.json(...)`, `res.set(...)`,
- a way to register **functions that run for matching requests**.

### Middleware: an assembly line

A **middleware** is a function with this shape:

```ts
(req, res, next) => {
  // look at or change req / res
  next(); // pass the request to the next function in line
};
```

Picture an airport:

```
passenger → check-in → security → passport control → gate → plane
```

Each desk does one job, then sends you on. Any desk can also **stop** you ("your bag is too heavy": respond right away and never call `next()`).

In Express, each middleware can do exactly one of three things:

1. **Pass the request on**: call `next()`.
2. **Finish the request**: send a response (`res.json(...)`), and not call `next()`.
3. **Report an error**: call `next(error)`, or simply `throw` (see below).

Route handlers (the function that finally produces `GET /users/:id`'s answer) are just middleware that always finish the request.

### Registering middleware

```ts
app.use(fn); // every request, any method, any path
app.use("/api", fn); // every request whose path starts with /api
router.get("/:id", a, b, c); // GET requests matching /:id, run a → b → c
```

Middleware runs **in the order it was registered**. That order is the most important design decision in `app.ts`.

### Errors travel on a separate track

Express has two kinds of middleware:

- normal: `(req, res, next)`,
- **error middleware**: `(error, req, res, next)`, with **four** arguments.

When something reports an error, Express **skips every remaining normal middleware** and jumps to the next error middleware:

```
 normal track:  A ──▶ B ──▶ C ──▶ D ──▶ notFound
                      │ throw
 error track:         └───────────────────────▶ errorMiddleware ──▶ response
```

### Express 5 and `async`

In Express 4, a rejected promise in an `async` handler was **not** caught; the request would hang or crash the process unless you wrapped every handler in `try/catch` or an `asyncHandler(...)` helper.

**Express 5** (used here) handles it: if a handler returns a promise that rejects, Express calls `next(error)` for you. So this works without any wrapper:

```ts
// src/modules/users/user.controller.ts
findById: RequestHandler<UserIdParamsDto> = async (req, res) => {
  assertOwnerOrRole(getAuth(res), req.params.id, "admin"); // may throw 403

  const user = await this.userService.findById(req.params.id); // may reject with 404

  sendSuccess(
    res,
    StatusCodes.OK,
    toUserResponse(user),
    "User retrieved successfully",
  );
};
```

Both a synchronous `throw` and an `await` that rejects end up in the error middleware.

## In this boilerplate

### The global chain in `src/app.ts`

```ts
// src/app.ts
export const createApp = (dependencies: AppDependencies): Express => {
  const { config, redis } = dependencies;
  const app = express();

  // Number of reverse proxies in front of the app (nginx, load balancer).
  app.set("trust proxy", config.TRUST_PROXY);

  // Observability first, so rejected requests are still logged.
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);

  // Security before body parsing, so rejected requests are never parsed.
  app.use(helmet());
  app.use(cors(createCorsOptions(config.CORS_ORIGIN)));
  app.use(createGlobalLimiter(config.RATE_LIMIT_MAX, redis));

  // gzip/brotli for responses over 1kb. ...
  app.use(compression());

  // JSON only, with a size cap. Multipart uploads are parsed per route.
  app.use(express.json({ limit: "100kb" }));

  app.use("/api", createRoutes(dependencies));

  app.use(notFoundMiddleware);
  // Must be registered last.
  app.use(
    createErrorMiddleware({ exposeStack: config.NODE_ENV !== "production" }),
  );

  return app;
};
```

Why each position matters:

| #   | Middleware                | Why it is here and not elsewhere                                                                                                   |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| —   | `trust proxy` setting     | Not middleware, but must be set before anything reads `req.ip` (rate limiter, audit log). Chapter 9.                               |
| 1   | `requestIdMiddleware`     | First, so **every** response (even a 429 or a 400) carries `X-Request-Id`, and the request context exists for everything after it. |
| 2   | `requestLoggerMiddleware` | Second, so rejected requests (rate limited, malformed) are still logged with their final status.                                   |
| 3   | `helmet()`                | Security headers on every response, including errors.                                                                              |
| 4   | `cors(...)`               | Must answer browser "preflight" `OPTIONS` requests before any route could reject them.                                             |
| 5   | global rate limiter       | Before body parsing and routing: an attacker flooding you should cost you as little work as possible.                              |
| 6   | `compression()`           | It wraps `res` so that **later** writes are compressed, so it must come before the routes that write responses.                    |
| 7   | `express.json()`          | Parses the body only for requests that survived the cheap checks above. The 100kb cap prevents memory abuse.                       |
| 8   | `/api` router             | The actual application.                                                                                                            |
| 9   | `notFoundMiddleware`      | Runs only if no route answered.                                                                                                    |
| 10  | error middleware          | **Last**, so it can catch errors from everything above it.                                                                         |

### Routers and mounting

A `Router` is a mini-app: you register routes on it and then **mount** it at a path prefix. Prefixes add up:

```ts
// src/routes.ts
const v1 = Router();
v1.use("/authentication", authentication.router);
v1.use("/users", users.router);
v1.use("/files", files.router);
v1.use("/audit-logs", audit.router);

const router = Router();
router.use("/health", health.router);
router.use(API_VERSION_PREFIX, v1); // "/v1"
```

```ts
// src/app.ts
app.use("/api", createRoutes(dependencies));
```

```ts
// src/modules/users/user.routes.ts
router.get(
  "/:id",
  validate({ params: userIdParamsSchema }),
  userController.findById,
);
```

`/api` + `/v1` + `/users` + `/:id` = `GET /api/v1/users/:id`. Inside the users router, the path is just `/:id`; the router does not know where it is mounted, which makes it reusable.

A router can also have **its own middleware** that applies to all its routes:

```ts
// src/modules/users/user.routes.ts
router.use(authenticate); // every /users route requires a token
```

And a single route can stack several middleware, which run left to right:

```ts
router.get(
  "/",
  requireRole("admin"), // 1. is the caller an admin?
  validate({ query: listUsersQuerySchema }), // 2. are the query params valid?
  userController.findAll, // 3. do the work
);
```

### `res.locals`: a backpack for the request

Middleware often discovers something that later code needs ("who is calling?"). `res.locals` is an object that lives exactly as long as one request; anything you put there is visible to later middleware and handlers of **the same** request only.

```ts
// src/modules/authentication/authenticate.middleware.ts
const auth = tokenService.verifyAccessToken(token);
res.locals.auth = auth;
```

```ts
// later, in a controller
export const getAuth = (res: Response): AuthContext => {
  if (!res.locals.auth) {
    throw new Error("getAuth() called on a route without authenticate");
  }

  return res.locals.auth;
};
```

TypeScript knows what is in `res.locals` thanks to a **global type declaration**:

```ts
// src/modules/authentication/authenticate.middleware.ts
declare global {
  namespace Express {
    interface Locals {
      /** Set by `authenticate` on protected routes. */
      auth?: AuthContext;
    }
  }
}
```

The request id middleware does the same for `res.locals.requestId`.

### A real middleware, line by line: the request logger

```ts
// src/shared/middlewares/request-logger.middleware.ts
export const requestLoggerMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();

  res.on("finish", () => {
    logger.info("HTTP request completed", {
      requestId: res.locals.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};
```

1. It records the start time.
2. It registers a listener on the response's `finish` event (fired when the response has been fully sent). It cannot log now, because the status code is not known yet.
3. It calls `next()` immediately, so the request continues.
4. Later, when any code anywhere sends the response, the listener writes one log line with the final status and duration. The query string is cut off (`split("?")[0]`) because it may contain tokens or personal data.

### Middleware factories

Many middleware here are created by a **function that returns a middleware**, so they can receive configuration:

```ts
createGlobalLimiter(config.RATE_LIMIT_MAX, redis)  // returns a middleware
createErrorMiddleware({ exposeStack: ... })        // returns an error middleware
validate({ params: userIdParamsSchema })           // returns a middleware
requireRole("admin")                               // returns a middleware
```

This keeps middleware free of global state: each app gets its own configured instance (important for tests, where each test builds a fresh app with fresh rate-limit counters).

## Step by step: what happens on `GET /api/v1/users/abc`

```
requestId ─▶ logger ─▶ helmet ─▶ cors ─▶ limiter ─▶ compression ─▶ json
   ─▶ /api router ─▶ /v1 router ─▶ /users router
        ─▶ authenticate        (valid token → res.locals.auth, next())
        ─▶ validate(params)    ("abc" is not a UUID → next(HttpError 400))
        ✗  userController.findById   (skipped)
   ✗ notFoundMiddleware              (skipped: we are on the error track)
   ─▶ errorMiddleware → 400 {"errorCode":"VALIDATION_ERROR", ...}
   (response finished → logger writes: statusCode 400, durationMs ...)
```

## Try it yourself

1. Register and keep the token:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Mia","email":"mia@x.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
```

2. Trigger each stage of the chain and compare the answers:

```bash
# stopped by authenticate (no token)
curl -s http://localhost:3000/api/v1/users/abc
# {"statusCode":401,"message":"Authentication required","errorCode":"UNAUTHORIZED"}

# passes authenticate, stopped by validate
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/users/abc
# {"statusCode":400,"message":"Validation error","errorCode":"VALIDATION_ERROR","details":[{"path":"id","message":"Invalid UUID"}]}

# passes validate, stopped by the authorization check in the controller
curl -s -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/users/00000000-0000-4000-8000-000000000000
# {"statusCode":403,"message":"You do not have permission to perform this action","errorCode":"FORBIDDEN"}
```

3. Write your own middleware (experiment only, then undo it). In `src/app.ts`, right after `requestLoggerMiddleware`, add:

```ts
app.use((req, res, next) => {
  res.set("X-Hello", "world");
  next();
});
```

`npm run dev` reloads; `curl -s -D - -o /dev/null http://localhost:3000/api/health/live` now shows `X-Hello: world`. Try removing `next()`: requests now hang forever, because nobody answers and nobody passes the request on. That is the most common middleware bug.

## Common mistakes

- **Forgetting `next()`** (request hangs) or **calling `next()` after sending a response** (Express may try to send twice: "Cannot set headers after they are sent").
- **Registering the error middleware too early.** Errors from routes registered after it never reach it.
- **Parsing the body before cheap rejections.** Rate limiting and CORS should come first.
- **Putting request data in module-level variables.** Two concurrent requests would overwrite each other. Use `res.locals` (or the request context, chapter 14).
- **Wrapping every handler in `try/catch` just to call `next(error)`.** Not needed in Express 5; only catch when you want to _translate_ an error.

## Summary

- Express turns HTTP requests into calls to your functions with `req`, `res`, `next`.
- Middleware runs in registration order; each one passes on, finishes, or reports an error.
- Errors switch to a separate track that ends in the four-argument error middleware; Express 5 does this automatically for `async` handlers.
- `app.ts` orders middleware deliberately: observability, then security, then compression and parsing, then routes, then 404, then errors.
- Routers are mounted at prefixes that add up; `res.locals` carries per-request data such as the authenticated caller.

Next: [04 · Module architecture](04-module-architecture.md)
