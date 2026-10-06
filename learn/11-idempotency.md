# 11. Idempotency

## Goals

By the end of this chapter you will understand:

- Why retries are dangerous for requests that create or change things.
- The difference between **safe** and **idempotent** HTTP methods.
- How an `Idempotency-Key` header makes a retry safe.
- Every step of `src/shared/middlewares/idempotency.middleware.ts`.
- Why the middleware sits **after** `authenticate` and `multer` on the upload route.

## Core concepts

### A story: the double payment

Ana pays for a concert ticket in an app. She taps "Pay", the spinner turns... and her train enters a tunnel. The connection drops. Did the payment go through? The app does not know: maybe the request never reached the server, or maybe the server charged her and only the **response** got lost.

The app (or Ana) tries again. If the first request did succeed, Ana is now charged twice.

```
Client                         Server
  │── POST /payments ─────────▶ │  charges €50 ✔
  │      ✖ response lost  ◀──── │
  │── POST /payments (retry) ─▶ │  charges €50 again ✘✘
```

Networks fail all the time: mobile connections, timeouts, proxies, a user double-clicking a button. Retrying is the right reaction to a failure, **as long as retrying cannot do the action twice**.

### Safe and idempotent methods

- A method is **safe** if it does not change anything on the server. `GET` is safe: reading a profile twice changes nothing.
- A method is **idempotent** if doing it many times has the **same effect** as doing it once. `PUT /users/1 {name: "Ana"}` is idempotent: after one or ten calls, the name is "Ana". `DELETE` is idempotent too: the thing is gone either way.
- `POST` is **neither**: each `POST /files` creates a new file. Ten retries create ten files.

(The word comes from mathematics: `abs(abs(x)) = abs(x)`; applying it again changes nothing.)

### The Idempotency-Key idea

The fix, popularized by Stripe's payment API, is simple:

1. The **client** generates a unique key for one logical action (for example a UUID) and sends it in a header: `Idempotency-Key: 3f1c...`.
2. The **server** remembers the key together with the response it produced.
3. If the same key arrives again, the server **replays the stored response** instead of doing the action again.

Like a coat-check ticket: if you show the same ticket twice, you get your coat back, not a second coat.

The client must reuse the **same key for retries** of the same action, and use a **new key** for a new action.

## In this boilerplate

The middleware lives in `src/shared/middlewares/idempotency.middleware.ts`. It is created once in `src/routes.ts`:

```ts
const idempotency = createIdempotency(cache);
```

and used on the upload route in `src/modules/files/file.routes.ts`:

```ts
router.use(authenticate);

// Idempotency comes after multer: the file is part of the fingerprint.
router.post("/", upload, idempotency, fileController.upload);
```

It stores its records in the same `Cache` as chapter 10: Redis when configured, memory otherwise.

### The constants

```ts
const HEADER = "Idempotency-Key";
const VALID_KEY = /^[A-Za-z0-9._:-]{1,255}$/;

/** How long a finished response can be replayed. */
const RESULT_TTL_SECONDS = 24 * 60 * 60;
/** Upper bound for a request in progress; a crashed one frees its key. */
const LOCK_TTL_SECONDS = 60;
```

- Finished responses are remembered for **24 hours**: long enough for any sensible retry.
- While a request is still running, its key is "locked" for at most **60 seconds**. If the server crashes in the middle, the lock expires on its own instead of blocking that key forever.

### The record stored per key

```ts
type IdempotencyRecord =
  | { state: "processing"; fingerprint: string }
  | {
      state: "completed";
      fingerprint: string;
      statusCode: number;
      body: unknown;
    };
```

A key is either **processing** (the first request is still running) or **completed** (we have its status and body to replay).

## Step by step through the middleware

### 1. No header? Do nothing

```ts
const key = req.get(HEADER);

if (key === undefined) {
  next();
  return;
}
```

Idempotency is **opt-in**. Clients that do not send the header get normal behavior.

### 2. Validate the key

```ts
if (!VALID_KEY.test(key)) {
  throw HttpError.badRequest(
    `${HEADER} must be 1-255 characters of [A-Za-z0-9._:-]`,
    { errorCode: "INVALID_IDEMPOTENCY_KEY" },
  );
}
```

The key ends up inside a Redis key name, so only a safe set of characters with a maximum length is accepted (never trust input, chapter 5).

### 3. Scope the key to the caller

```ts
const scope = res.locals.auth?.userId ?? `ip:${req.ip}`;
const cacheKey = `idempotency:${scope}:${key}`;
```

Keys are stored **per user** (or per IP on a public route). Without this, user B sending the key `k1` would receive user A's stored response for `k1`, which would leak A's data. This is why the middleware must run **after `authenticate`**: before it, `res.locals.auth` is not set yet.

### 4. Fingerprint the request

```ts
const fingerprintOf = (method, path, body, file) =>
  createHash("sha256")
    .update(method)
    .update(path)
    .update(JSON.stringify(body ?? null))
    .update(file ? createHash("sha256").update(file.buffer).digest("hex") : "")
    .digest("hex");
```

A **fingerprint** is a short summary (a SHA-256 hash) of _what_ the request asked for: method, path, JSON body and, for uploads, the file's bytes. It lets the server notice when a client reuses a key for a **different** request, which is a client bug the server should report rather than silently replaying the wrong answer.

The file is part of the fingerprint, and `req.file` only exists after multer parsed the upload. That is why the middleware runs **after `multer`**.

### 5. Try to take the lock (atomically)

```ts
const acquired = await cache
  .setIfAbsent(
    cacheKey,
    { state: "processing", fingerprint } satisfies IdempotencyRecord,
    LOCK_TTL_SECONDS,
  )
  .catch(unavailable);
```

`setIfAbsent` (Redis `SET ... NX`, chapter 10) is **atomic**: if two identical requests arrive at the same moment, exactly one gets `true`. Checking "does the key exist?" and then "write it" as two separate steps would allow both requests to see "no" and both run; this is a **race condition**, and atomic operations prevent it.

### 6a. Lock acquired: run the request and remember the response

```ts
let responseBody: unknown;
const json = res.json.bind(res);
res.json = (body: unknown) => {
  responseBody = body;
  return json(body);
};
```

The middleware **wraps** `res.json`: when the controller later sends its response (through `sendSuccess`, which calls `res.json`), the body is copied into `responseBody` and then sent normally.

```ts
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
          },
          RESULT_TTL_SECONDS,
        );
  // errors here are logged, not thrown
};

res.once("close", release);
next();
```

When the response is finished (`close` event):

- **Status below 500** and fully sent → store it as `completed` for 24 hours. This includes 4xx errors: a request that failed validation will fail the same way again, so replaying the same answer is correct.
- **5xx** (a server-side failure) or the response never fully written (client disconnected) → **delete** the key, so a retry runs again for real.

### 6b. Lock not acquired: someone used this key before

```ts
const existing = await cache
  .get<IdempotencyRecord>(cacheKey)
  .catch(unavailable);

if (existing && existing.fingerprint !== fingerprint) {
  throw new HttpError(`${HEADER} was already used for a different request`, {
    statusCode: StatusCodes.UNPROCESSABLE_ENTITY,
    errorCode: "IDEMPOTENCY_KEY_REUSED",
  });
}

if (existing?.state === "completed") {
  res.set("Idempotent-Replayed", "true");
  res.status(existing.statusCode).json(existing.body);
  return;
}

throw HttpError.conflict("A request with this Idempotency-Key is in progress", {
  errorCode: "IDEMPOTENCY_REQUEST_IN_PROGRESS",
});
```

- Different fingerprint → **422** `IDEMPOTENCY_KEY_REUSED`.
- Completed → **replay**: same status, same body, plus the header `Idempotent-Replayed: true` so the client can tell. The controller does **not** run.
- Still processing → **409** `IDEMPOTENCY_REQUEST_IN_PROGRESS`. The client should wait and retry.

This replay is the only place in the codebase that calls `res.json` directly instead of the response helpers: it sends back a body those helpers already built.

### 7. The store is down: fail closed

```ts
const unavailable = (error: unknown): never => {
  logger.error("Idempotency store unavailable", { ... });
  throw HttpError.serviceUnavailable(
    "Idempotent requests are temporarily unavailable, please retry",
    { errorCode: "IDEMPOTENCY_UNAVAILABLE" },
  );
};
```

If Redis cannot be reached, the server cannot keep its promise ("this will not happen twice"). Running the request anyway could create exactly the duplicate the client was protecting against. So it **fails closed** with a **503**, which tells the client "temporary problem, retry later". Requests **without** the header are not affected.

## Flow diagram

```mermaid
flowchart TD
  A[Request] --> B{Idempotency-Key header?}
  B -- no --> Z[Run normally]
  B -- yes --> C{Valid key?}
  C -- no --> E400[400 INVALID_IDEMPOTENCY_KEY]
  C -- yes --> D[setIfAbsent processing lock]
  D -- store down --> E503[503 IDEMPOTENCY_UNAVAILABLE]
  D -- acquired --> R[Run controller, capture body]
  R --> S{status >= 500 or not sent?}
  S -- yes --> DEL[Delete key: retry will run again]
  S -- no --> SAVE[Store completed response for 24h]
  D -- taken --> G[Read existing record]
  G --> H{Same fingerprint?}
  H -- no --> E422[422 IDEMPOTENCY_KEY_REUSED]
  H -- yes --> I{Completed?}
  I -- yes --> REPLAY[Replay stored response + Idempotent-Replayed: true]
  I -- no --> E409[409 IDEMPOTENCY_REQUEST_IN_PROGRESS]
```

## All cases in one table

| Situation                                       | Response                                                             |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| No `Idempotency-Key` header                     | Normal behavior                                                      |
| Malformed key                                   | 400 `INVALID_IDEMPOTENCY_KEY`                                        |
| First request with a key                        | Runs normally; response stored for 24 h                              |
| Retry, same key, same request                   | Stored response replayed, `Idempotent-Replayed: true` (also for 4xx) |
| Retry while the first is still running          | 409 `IDEMPOTENCY_REQUEST_IN_PROGRESS`                                |
| Same key, different request (body/file differs) | 422 `IDEMPOTENCY_KEY_REUSED`                                         |
| First request ended with 5xx                    | Not stored; the retry runs again                                     |
| Same key, different user                        | Independent (keys are scoped per user)                               |
| Cache/Redis unavailable                         | 503 `IDEMPOTENCY_UNAVAILABLE`                                        |

All of these cases are covered by tests in `src/modules/files/files.test.ts` and `src/shared/middlewares/idempotency.middleware.test.ts`.

## Try it yourself

```bash
# Get a token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Idem Demo","email":"idem@example.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# A tiny valid PNG (just the 8-byte signature plus some data)
printf '\x89PNG\r\n\x1a\nhello' > /tmp/demo.png

# Upload twice with the same key
for i in 1 2; do
  curl -s -D - -o /dev/null -X POST http://localhost:3000/api/v1/files \
    -H "Authorization: Bearer $TOKEN" \
    -H "Idempotency-Key: upload-demo-1" \
    -F "file=@/tmp/demo.png" | grep -iE "^HTTP|idempotent"
done
```

Expected output:

```
HTTP/1.1 201 Created
HTTP/1.1 201 Created
Idempotent-Replayed: true
```

Check that only one file exists:

```bash
curl -s http://localhost:3000/api/v1/files -H "Authorization: Bearer $TOKEN"
# ... "meta":{"page":1,"limit":10,"total":1,"totalPages":1}
```

Now reuse the key with a **different** file:

```bash
printf '\x89PNG\r\n\x1a\nsomething else' > /tmp/other.png
curl -s -X POST http://localhost:3000/api/v1/files \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: upload-demo-1" \
  -F "file=@/tmp/other.png"
```

```json
{
  "statusCode": 422,
  "message": "Idempotency-Key was already used for a different request",
  "errorCode": "IDEMPOTENCY_KEY_REUSED"
}
```

With Redis configured, you can see the stored record:

```bash
docker compose exec redis redis-cli --scan --pattern 'cache:idempotency:*'
```

## Common mistakes

- **Check-then-write instead of an atomic lock.** Two simultaneous requests both pass the check. Use `SET NX`.
- **Global keys instead of per-user keys.** One user could read another user's stored response.
- **Not comparing the request.** Replaying the response of a different request hides client bugs; the fingerprint catches them.
- **Storing 5xx responses.** The client could never recover from a temporary server failure.
- **Running without the store when it is down.** That silently drops the guarantee; fail closed instead.
- **Generating a new key on each retry (client side).** Then every retry looks like a new action. The key belongs to the action, not to the attempt.
- **Storing secrets in replayable responses.** This boilerplate only applies idempotency to uploads; it is deliberately not used on `register`, whose response contains tokens.

## Summary

- `POST` is not idempotent; network retries can repeat actions.
- An `Idempotency-Key` lets the server recognize a retry and replay the first response.
- The middleware: validate key → scope per user → fingerprint → atomic lock → run and capture → store non-5xx for 24 h, or replay / 409 / 422.
- It fails **closed** (503) when its store is unavailable.
- Order matters: after `authenticate` (for the scope) and after `multer` (for the fingerprint).

Next: [12. Background jobs and email](12-background-jobs-and-email.md).
