# 09. Application Security

## Goals

By the end of this chapter you will understand:

- the main categories of web API risks (in the spirit of the OWASP Top 10) and which line of code addresses each;
- what security headers (helmet) do;
- what CORS really protects, and what it does **not**;
- how rate limiting works here, why it is shared through Redis, and why it "fails open";
- why `trust proxy` must match your infrastructure;
- the small defenses that add up: body size limits, input validation, request id sanitization, hidden error details, careful logging, secret management and dependency auditing.

## Core concepts

Security is not one feature; it is **layers**. Analogy: a bank has a guard at the door, cameras, a vault, and limits on withdrawals. Any one layer can fail; together they make an attack expensive. This idea is called **defense in depth**.

**OWASP** (Open Worldwide Application Security Project) publishes the well-known Top 10 lists of web and API risks. The table below maps the most relevant ones to this boilerplate; the rest of the chapter goes through the defenses one by one.

| Risk                                 | Example attack                                | Where it is addressed                                       | Chapter  |
| ------------------------------------ | --------------------------------------------- | ----------------------------------------------------------- | -------- |
| Broken access control                | Reading another user's data by changing an id | `requireRole`, `assertOwnerOrRole`, 404 for foreign files   | 8        |
| Broken authentication                | Password guessing, stolen tokens              | Argon2id, short JWTs, refresh rotation, credentials limiter | 7        |
| Injection                            | `' OR 1=1 --` in a search box                 | Drizzle parameterized queries, Zod validation               | 5, 6     |
| Unrestricted resource consumption    | Flooding the API, huge request bodies         | Rate limits, 100kb JSON limit, upload size limit            | this, 13 |
| Security misconfiguration            | Stack traces in production, permissive CORS   | Env validation, hidden error details, CORS allowlist        | this     |
| Vulnerable components                | A dependency with a known CVE                 | `npm audit` in CI, `overrides`                              | this     |
| Sensitive data exposure (incl. logs) | Passwords or tokens in logs                   | Mappers strip hashes, query strings not logged              | this, 15 |
| Unsafe file handling                 | Uploading a script disguised as an image      | Magic-byte detection, generated storage keys                | 13       |

## In this boilerplate

The order of middleware in `src/app.ts` is itself a security decision:

```ts
// src/app.ts
app.set("trust proxy", config.TRUST_PROXY);

// Observability first, so rejected requests are still logged.
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// Security before body parsing, so rejected requests are never parsed.
app.use(helmet());
app.use(cors(createCorsOptions(config.CORS_ORIGIN)));
app.use(createGlobalLimiter(config.RATE_LIMIT_MAX, redis));

app.use(compression());

// JSON only, with a size cap. Multipart uploads are parsed per route.
app.use(express.json({ limit: "100kb" }));
```

A request that is going to be rejected (blocked by rate limiting, for example) is refused **before** the server spends effort reading and parsing its body.

### 1. Security headers with helmet

HTTP response headers can instruct browsers to enable protections. `helmet()` sets a collection of sensible defaults. Among the headers this app sends:

| Header                                                       | What it tells the browser                                                           |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `Content-Security-Policy`                                    | Which sources scripts, styles, images may load from; blocks injected inline scripts |
| `Strict-Transport-Security`                                  | Always use HTTPS for this site in future (HSTS)                                     |
| `X-Content-Type-Options: nosniff`                            | Trust the declared `Content-Type`; do not "guess" that a file is HTML or script     |
| `X-Frame-Options: SAMEORIGIN`                                | Do not let other sites embed this one in a frame (clickjacking)                     |
| `Referrer-Policy: no-referrer`                               | Do not leak the current URL to other sites                                          |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | Isolate this origin from others                                                     |

Helmet also **removes** `X-Powered-By: Express`, which would advertise the framework to attackers scanning for known vulnerabilities. The test `sets security headers` in `src/app.test.ts` checks `nosniff` and the absence of `X-Powered-By`.

For a JSON API many of these matter less than for a website, but they cost nothing and they protect the Swagger UI page and file downloads. Swagger UI works under the strict CSP because it is served without inline scripts (`src/docs/docs.test.ts` checks this).

### 2. CORS: what it is and what it is not

Browsers enforce the **same-origin policy**: JavaScript on `https://evil.com` may not read responses from `https://api.yourapp.com`. **CORS** (Cross-Origin Resource Sharing) is how a server **relaxes** that rule for specific origins it trusts, through response headers such as `Access-Control-Allow-Origin`.

```ts
// src/config/cors.config.ts
export const createCorsOptions = (corsOrigin: string): CorsOptions => {
  const allowedOrigins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin:
      allowedOrigins.includes("*") || allowedOrigins.length === 0
        ? "*"
        : (origin, callback) => {
            // Disallowed origins get no CORS headers, so the browser blocks
            // the response. Requests without an Origin (curl, server-to-server)
            // pass.
            callback(null, !origin || allowedOrigins.includes(origin));
          },
  };
};
```

`CORS_ORIGIN=https://app.example.com,https://admin.example.com` allows exactly those two web apps.

What CORS **does** protect: a malicious website open in a user's browser cannot read your API's responses using that browser.

What CORS does **not** protect:

- **It is not authentication.** `curl`, Postman, mobile apps and servers ignore CORS entirely. That is why requests without an `Origin` header pass: CORS is purely a browser feature, and every route must still check the token.
- It does not stop a request from being **sent**; it stops the browser page from **reading** the response.

`*` (any origin) is convenient in development but wrong in production, so the environment schema refuses it:

```ts
// src/config/env.ts
.refine(
  (env) =>
    env.NODE_ENV !== "production" ||
    (env.CORS_ORIGIN.trim() !== "" &&
      !env.CORS_ORIGIN.split(",").some((origin) => origin.trim() === "*")),
  {
    path: ["CORS_ORIGIN"],
    message: "CORS_ORIGIN must list explicit origins in production",
  },
);
```

A production server with `CORS_ORIGIN=*` **does not start**. Failing at startup is far better than discovering a misconfiguration after an incident.

### 3. Rate limiting

**Rate limiting** caps how many requests a client may make in a time window. Analogy: an ATM that lets you withdraw only a few times per day; it slows down a thief with your card. It protects against brute-force password guessing, scraping and simple denial-of-service floods.

There are two limiters in `src/config/rate-limit.config.ts`, both keyed by client IP:

| Limiter                       | Applies to                                | Limit                                     | Response                                                             |
| ----------------------------- | ----------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| `createGlobalLimiter`         | every request (`app.ts`)                  | `RATE_LIMIT_MAX` (default 100) per minute | `429 TOO_MANY_REQUESTS` "Too many requests, please try again later." |
| `createAuthenticationLimiter` | register, login, refresh, change-password | 10 **failed** requests per 15 minutes     | `429 TOO_MANY_REQUESTS` "Too many attempts, please try again later." |

`skipSuccessfulRequests: true` on the credentials limiter means only responses with status ≥ 400 count, so real users who type their password correctly are never locked out (chapter 7).

Responses carry standard headers (`standardHeaders: "draft-7"`) so well-behaved clients can slow down by themselves:

```
RateLimit-Policy: 100;w=60
RateLimit: limit=100, remaining=97, reset=42
```

**Where are the counters kept?** By default, in the memory of the Node process. With two API instances behind a load balancer, each instance would count separately, effectively doubling the limit. With `REDIS_URL` set, both limiters use a shared Redis store:

```ts
const createRedisStore = (redis: Redis, prefix: string): Store =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redis.call(command, ...args) as Promise<RedisReply>,
  });

export const createGlobalLimiter = (limit: number, redis?: Redis) =>
  rateLimit({
    ...
    ...(redis && {
      store: createRedisStore(redis, "global"),
      passOnStoreError: true,
    }),
    ...
  });
```

You can see the counters in Redis as keys like `rl:global:127.0.0.1` and `rl:authentication:127.0.0.1`.

**`passOnStoreError: true` ("fail open").** If Redis is unreachable, the limiter cannot count. There are two choices:

- **Fail closed**: refuse every request. The whole API goes down because a supporting service is down.
- **Fail open**: let requests through without limiting until Redis returns.

This boilerplate chooses fail open for rate limiting: a short window without limits is a smaller risk than a complete outage. (During development we measured exactly that failure: without this option, every request became a 500 while Redis was down.) The idempotency store makes the opposite choice; chapter 10 compares them.

### 4. `trust proxy` and IP spoofing

Rate limits and the audit log need the **client's** IP. In production, the app usually sits behind a reverse proxy or load balancer (nginx, a cloud LB). From the app's point of view, every request then comes **from the proxy's IP**. The proxy passes the real client IP in a header:

```
X-Forwarded-For: 203.0.113.7, 10.0.0.2
```

Express's `trust proxy` setting says how many proxies to believe:

```ts
app.set("trust proxy", config.TRUST_PROXY);
```

- `TRUST_PROXY=0` (default): ignore `X-Forwarded-For`; use the socket address. Right when nothing sits in front of the app.
- `TRUST_PROXY=1`: trust one hop; `req.ip` is the address the single proxy saw.

Why not just trust everything? Because **clients can write `X-Forwarded-For` themselves**. With trust set too high, an attacker sends `X-Forwarded-For: 1.2.3.4`, then `5.6.7.8`, ... and each request looks like a new client, bypassing rate limits and polluting audit IPs. Set it to the exact number of proxies you control, as the comment in `src/config/env.ts` warns.

### 5. Request body limits and malformed input

```ts
app.use(express.json({ limit: "100kb" }));
```

- Only `application/json` bodies are parsed here; other content types are ignored (uploads are parsed per route by multer, with their own size limit, chapter 13).
- Bodies over 100kb are rejected with `413` (`REQUEST_ENTITY_TOO_LARGE`) before reaching any code. Without a limit, one client could send gigabytes and exhaust memory.
- Malformed JSON (`{bad`) is rejected with `400 BAD_REQUEST`, carrying the parser's description (for example `"Expected property name or '}' in JSON at position 1 ..."`). The error middleware recognizes these errors from Express's body parser (they carry a 4xx `status`) and formats them like any other error.

Combined with Zod validation (chapter 5), every value a handler sees has a known shape, type and size. Strings have maximum lengths (`name` ≤ 100, `password` ≤ 128, `search` ≤ 100, ...), numbers have ranges (`limit` 1–100). Validation is the first defense against injection and resource abuse alike.

### 6. Sanitizing the request id

Clients (or load balancers) may send their own `X-Request-Id`, and the app echoes it and writes it into every log line. Unchecked, that is a door for **log injection** (fake log lines via newlines) or huge values:

```ts
// src/shared/middlewares/request-id.middleware.ts
const VALID_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

const incoming = req.get(REQUEST_ID_HEADER);
const requestId =
  incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();
```

Only short, safe values are reused; anything else is replaced with a fresh UUID. The same principle (validate before echoing or storing) applies to `Idempotency-Key` (chapter 11).

### 7. File uploads

Uploads are among the riskiest features: a "photo" may be an HTML page or a script, a filename may contain `../../`, and a file may be enormous. The defenses (content-based type detection, generated storage keys, size limits, `Content-Disposition: attachment` for downloads) are covered in [chapter 13](13-file-uploads.md).

### 8. Secrets and configuration

- Secrets (`JWT_SECRET`, database password, `SMTP_PASS`) come from **environment variables**, never from code. `.env` is git-ignored; `.env.example` is committed with empty values as documentation.
- The app **validates the environment at startup** (`src/config/env.ts`). `JWT_SECRET` must be at least 32 characters; `NODE_ENV` is required on purpose:

  ```ts
  // Required on purpose: defaulting to "development" would leak error
  // details on a production server that forgot to set NODE_ENV.
  NODE_ENV: z.enum(["development", "test", "production"]),
  ```

- Rotating `JWT_SECRET` invalidates every issued access token (useful after a suspected leak).
- The credentials in `docker-compose.yml` (`app`/`app`, root `root`) are for local development only.

### 9. Error details are hidden in production

When something unexpected fails, the error middleware answers `500 INTERNAL_SERVER_ERROR`. It adds the stack trace as `details` **only outside production**:

```ts
// src/app.ts
app.use(
  createErrorMiddleware({ exposeStack: config.NODE_ENV !== "production" }),
);
```

Stack traces reveal file paths, library versions and code structure, which helps attackers. Database errors are even more careful: the client only sees `DATABASE_ERROR`, and the log omits query parameters (chapter 6). In every case the response carries `X-Request-Id`, so support can find the full details in the logs without exposing them.

### 10. Careful logging

Logs are often copied to many systems and read by many people, so they must not become a data leak:

```ts
// src/shared/middlewares/request-logger.middleware.ts
logger.info("HTTP request completed", {
  requestId: res.locals.requestId,
  method: req.method,
  path: req.originalUrl.split("?")[0],
  statusCode: res.statusCode,
  durationMs: Date.now() - startedAt,
});
```

The **query string is dropped** from the logged path because it may contain tokens or personal data (`?email=...`). Bodies are never logged. Mappers such as `toUserResponse` make sure `passwordHash` never leaves the server. Chapter 15 covers logging in depth.

### 11. Dependencies

Most of the code running in your API was written by someone else (`node_modules`). Known vulnerabilities in those packages are published as advisories:

- CI runs `npm audit --audit-level=high` and fails on high-severity findings (`.github/workflows/ci.yml`).
- When a vulnerable package comes in through a dependency you cannot upgrade yet, `overrides` in `package.json` forces a fixed version:

  ```json
  "overrides": {
    "@esbuild-kit/core-utils": {
      "esbuild": "^0.25.12"
    }
  }
  ```

  The README's "Dependency Security Notes" explains why this one exists and when to remove it. Overrides are a temporary patch; leave a note so they do not live forever.

## Step by step: what a hostile request runs into

```
POST /api/v1/authentication/login   (from an attacker)
  │
  ├─ requestId      → unsafe X-Request-Id replaced
  ├─ helmet         → security headers set on whatever response follows
  ├─ cors           → no CORS headers for unknown browser origins
  ├─ global limiter → > RATE_LIMIT_MAX/min from this IP? 429, stop
  ├─ express.json   → > 100kb? 413. Malformed? 400. Stop
  ├─ credentials limiter → ≥ 10 failures in 15 min? 429, stop
  ├─ validate       → wrong shape/too long? 400, stop
  └─ service        → constant-time-ish failure, generic message, audit entry
```

## Try it yourself

```bash
# Security headers
curl -sI http://localhost:3000/api/health/live

# CORS: an allowed vs a disallowed origin (set CORS_ORIGIN=http://localhost:5173 in .env and restart)
curl -sI http://localhost:3000/api/health/live -H 'Origin: http://localhost:5173' | grep -i access-control
curl -sI http://localhost:3000/api/health/live -H 'Origin: https://evil.example'  | grep -i access-control
# the second prints nothing: no CORS headers, the browser would block reading the response

# Rate limit headers
curl -s -D - -o /dev/null http://localhost:3000/api/health/live | grep -i ratelimit

# Body too large (≈200kb)
curl -s -X POST http://localhost:3000/api/v1/authentication/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"a@b.com\",\"password\":\"$(head -c 200000 /dev/zero | tr '\0' a)\"}"
# {"statusCode":413,"message":"request entity too large","errorCode":"REQUEST_ENTITY_TOO_LARGE"}

# Malformed JSON
curl -s -X POST http://localhost:3000/api/v1/authentication/login \
  -H 'Content-Type: application/json' -d '{bad'
# {"statusCode":400,"message":"Expected property name or '}' in JSON at position 1 ...","errorCode":"BAD_REQUEST"}

# Unsafe request id is replaced
curl -s -D - -o /dev/null http://localhost:3000/api/health/live -H 'X-Request-Id: bad id<script>' | grep -i x-request-id

# Production refuses CORS_ORIGIN=*
NODE_ENV=production CORS_ORIGIN='*' npx tsx src/server.ts
# Error: Invalid environment variables: {"CORS_ORIGIN":["CORS_ORIGIN must list explicit origins in production"]}
```

To see the shared rate-limit counters (with `REDIS_URL` set):

```bash
docker compose exec redis redis-cli --scan --pattern 'rl:*'
```

## Common mistakes

- **Treating CORS as access control.** It only governs browsers; protect every route with authentication and authorization.
- **`CORS_ORIGIN=*` with credentials in production.** The env check prevents it here.
- **Rate limits in process memory with several instances.** Use a shared store (Redis).
- **`trust proxy = true` everywhere.** Clients can then spoof their IP.
- **No body size limit**, or one limit for everything; uploads need their own.
- **Leaking stack traces or SQL errors** to clients.
- **Logging full URLs, bodies or tokens.**
- **Secrets committed to git**, or defaults that "just work" in production (a default `JWT_SECRET`, a default `NODE_ENV=development`).
- **Ignoring `npm audit`** until something is exploited.

## Summary

- Security is layered: headers, CORS, rate limits, size limits, validation, authentication, authorization, careful errors and logs, safe configuration, and dependency hygiene.
- `helmet` sets protective headers and hides `X-Powered-By`.
- CORS lets chosen browser origins read responses; it is not authentication, and `*` is refused in production.
- Two IP-based limiters (global and credentials) share counters in Redis when available and fail open if Redis is down.
- `TRUST_PROXY` must equal the number of proxies you control.
- Bodies are capped at 100kb, inputs are validated, request ids sanitized, error details and query strings kept out of responses and logs.
- Secrets live in validated environment variables; CI audits dependencies.

Next: [10. Redis and caching](10-redis-and-caching.md)
