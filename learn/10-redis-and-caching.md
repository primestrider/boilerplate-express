# 10. Redis and Caching

## Goals

By the end of this chapter you will understand:

- What Redis is and why backends use it.
- What a cache is, and the **cache-aside** pattern this boilerplate uses.
- How the `Cache` interface, `RedisCache`, `MemoryCache` and `CachedUserRepository` fit together.
- How cached data is kept fresh (invalidation and TTL).
- What happens when Redis goes down, the real bug this project ran into, and how it was fixed.
- The difference between **fail open** and **fail closed**, and how to choose.

## Core concepts

### What is Redis?

**Redis** is a database that keeps its data **in memory** (RAM) instead of on disk first. Reading from RAM is extremely fast (well under a millisecond), so Redis is used for data that is read very often or must be shared quickly between processes.

Redis is a **key-value store**: you save a value under a name (the key) and read it back by that name, like a giant dictionary or a coat-check counter: you hand over your coat, get ticket number `42`, and later show `42` to get the coat back.

```
SET  user:42  "{...json...}"     # store
GET  user:42                      # read  -> "{...json...}"
DEL  user:42                      # remove
```

Two features of Redis matter most in this project:

- **TTL (time to live)**: a key can expire on its own. `SET key value EX 60` means "keep this for 60 seconds, then forget it". Like a parking ticket that is only valid for one hour.
- **NX ("only if not exists")**: `SET key value NX` stores the value **only if the key does not exist yet** and tells you whether it worked. This is an **atomic** operation: even if two clients send it at the exact same moment, Redis guarantees only one of them wins. That makes it a simple lock (used in chapter 11).

### What is a cache?

A **cache** is a fast copy of data whose original lives somewhere slower. A good analogy: you keep the phone numbers you call most on a sticky note on your desk, instead of opening the big phone book every time. The phone book (the database) is the **source of truth**; the sticky note (the cache) is just a shortcut.

Caching has one hard problem: the copy can become **stale** (out of date) when the original changes. Every caching design is mostly about answering "how do we keep the copy fresh enough?".

### The cache-aside pattern

The most common pattern, and the one used here, is **cache-aside** (also called "lazy loading"): the application itself checks the cache first and fills it on a miss.

```
read(id):
  ┌─────────────┐   1. GET user:id    ┌───────┐
  │ Application │ ──────────────────▶ │ Cache │
  │             │ ◀────────────────── │       │
  │             │   2a. hit → return  └───────┘
  │             │
  │             │   2b. miss → SELECT  ┌──────────┐
  │             │ ───────────────────▶ │ Database │
  │             │ ◀─────────────────── │          │
  │             │   3. SET user:id (TTL) in cache
  └─────────────┘

write(id):
  1. UPDATE the database
  2. DEL user:id from the cache   (next read reloads fresh data)
```

- A **hit** means the value was found in the cache.
- A **miss** means it was not, so the database answers and the result is stored for next time.
- **Invalidation** (or "eviction") means deleting the cached copy after a write, so the next read loads the new data.

## In this boilerplate

### The `Cache` interface

`src/shared/cache/cache.ts` defines what any cache must be able to do:

```ts
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Stores the value only if the key is absent. Returns true when stored. */
  setIfAbsent(
    key: string,
    value: unknown,
    ttlSeconds: number,
  ): Promise<boolean>;
  delete(key: string): Promise<void>;
}
```

Code that needs a cache depends on this **interface**, not on Redis. There are two implementations:

| Class         | Where the data lives        | Used when                                     |
| ------------- | --------------------------- | --------------------------------------------- |
| `RedisCache`  | Redis, shared by every app  | `REDIS_URL` is set                            |
| `MemoryCache` | A `Map` inside this process | No `REDIS_URL` (local development), and tests |

### `RedisCache`

```ts
async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await this.redis.set(
    this.prefix + key,
    JSON.stringify(value),
    "EX",
    ttlSeconds,
  );
}
```

Three details are worth noticing:

1. **Key prefix.** Every key gets `cache:` in front (the default `prefix`), so `user:abc` is stored as `cache:user:abc`. Prefixes keep different kinds of data in Redis apart (rate limits use `rl:`, BullMQ uses `bull:`).
2. **JSON serialization.** Redis stores strings, so values are turned into JSON with `JSON.stringify` and parsed back with `JSON.parse`.
3. **`setIfAbsent` uses `NX`.** `redis.set(key, value, "EX", ttl, "NX")` returns `"OK"` only if the key was created, which is why the method returns `result === "OK"`.

### `MemoryCache`

`MemoryCache` behaves the same way but keeps entries in a `Map` with an `expiresAt` timestamp. It also stores values as JSON strings on purpose (the comment says "so callers get copies just like with Redis"): if it stored objects directly, a caller could change a cached object by accident and behave differently than with Redis.

To avoid growing forever, it holds at most `MAX_MEMORY_ENTRIES = 10_000` entries: when full it removes expired entries, and if still full, the oldest ones.

`MemoryCache` is fine for **one** process. With two app instances, each has its own `Map`, so they would disagree, which is why production with several instances needs Redis.

### `CachedUserRepository`: cache-aside as a decorator

The cache is used for users in `src/modules/users/cached-user.repository.ts`. Instead of adding cache code into `UserService` or `DrizzleUserRepository`, the boilerplate uses the **decorator pattern**: a class that implements the same interface (`UserRepository`) and **wraps** another implementation, adding behavior around it.

```
UserService ──▶ CachedUserRepository ──▶ DrizzleUserRepository ──▶ MySQL
                     │
                     └──▶ Cache (Redis or memory)
```

The wiring happens in `src/modules/users/user.module.ts`:

```ts
const repository = new CachedUserRepository(
  new DrizzleUserRepository(db),
  cache,
);
```

`UserService` does not know a cache exists; it just talks to a `UserRepository`. You could remove caching by deleting one line.

#### Reading: `findById`

```ts
async findById(id: string): Promise<User | null> {
  const cached = await this.tryCache(() =>
    this.cache.get<CachedUser>(keyOf(id)),
  );
  if (cached) return revive(cached);

  const user = await this.inner.findById(id);
  // Misses are not cached, so a new user is visible right away.
  if (user)
    await this.tryCache(() => this.cache.set(keyOf(id), user, TTL_SECONDS));

  return user;
}
```

Step by step:

1. Look for `user:<id>` in the cache.
2. **Hit**: return it (after `revive`, explained below).
3. **Miss**: ask the real repository (MySQL).
4. If the user exists, store it with a TTL of 60 seconds.
5. If the user does not exist, **nothing is cached**. Caching "not found" would mean a user created a moment later stays invisible until the entry expires.

Only `findById` is cached. It is called by the profile endpoint, `GET /users/:id`, and token refresh, so it is the hottest lookup. List queries and email lookups go straight to the database.

#### Reviving dates

JSON has no date type. A `Date` becomes a string like `"2026-10-06T04:52:34.343Z"` when stringified, and stays a string when parsed. The `revive` function turns those strings back into `Date` objects, so the rest of the code always gets a proper `User`:

```ts
const revive = (user: CachedUser): User => ({
  ...user,
  createdAt: new Date(user.createdAt),
  updatedAt: new Date(user.updatedAt),
  deletedAt: user.deletedAt === null ? null : new Date(user.deletedAt),
});
```

Forgetting this is a classic caching bug: code calls `user.createdAt.toISOString()` and crashes, but only on a cache hit.

#### Writing: invalidate on every write

Every method that changes a user calls `evict` after the database write:

```ts
async updateRole(id: string, role: UserRole): Promise<void> {
  await this.inner.updateRole(id, role);
  await this.evict(id);
}
```

The same happens in `update`, `updatePasswordHash` and `softDelete`. Because **all** writes in the app go through this repository (the authentication module receives the same instance from `routes.ts`), the cache cannot keep a stale user after a change made through the API.

#### The TTL as a safety net

Some writes do **not** go through this repository:

- The `npm run user:make-admin` CLI uses `DrizzleUserRepository` directly.
- Someone may run SQL by hand.

For those, the 60-second TTL is the **staleness bound**: in the worst case, the old value is served for up to a minute, then it expires and the next read loads the truth. The comment at the top of the file states this explicitly, and so does the CLI's header comment.

## What happens when Redis is down?

A cache is an optimization, so a broken cache should make the app **slower**, not **broken**. This project learned that the hard way.

### The bug we hit

While testing, Redis was stopped while the API was running. Every request, even `GET /api/health/live`, suddenly took **24 to 60 seconds**.

The reason: **ioredis** (the Redis client library) has an **offline queue**. When the connection drops, it does not fail commands; it keeps them in a queue and retries them on every reconnect attempt, by default up to 20 times with growing delays. Meanwhile the request waits.

And the global rate limiter (chapter 9) talks to Redis on **every** request, so every request waited.

```
request ──▶ rate limiter ──▶ redis.incr(...)  ──▶ [offline queue]
                                                   ... reconnect 1 fails
                                                   ... reconnect 2 fails
                                                   ... (up to ~20 tries)
                                       24–60 s later: error
```

### The fix: fail fast

`src/server.ts` now creates the client like this:

```ts
const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, commandTimeout: 1000 })
  : undefined;
```

- `maxRetriesPerRequest: 1`: give up on a command after one reconnect attempt instead of 20.
- `commandTimeout: 1000`: a command that has no answer within one second fails.

Failing fast alone is not enough; the code that receives the error must also decide what to do. Each caller makes that choice on purpose.

### Fail open vs fail closed

When a protective or helpful component is unavailable, you can:

- **Fail open**: let the request through without the component. Like a shop whose card reader is broken accepting cash instead of closing.
- **Fail closed**: refuse the request. Like a bank vault that stays locked when the alarm system is offline.

| Component (uses Redis)      | Choice      | Why                                                                                              | Where                                              |
| --------------------------- | ----------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| User cache                  | Fail open   | It is only a shortcut; MySQL still has the truth                                                 | `tryCache` in `cached-user.repository.ts`          |
| Rate limiters               | Fail open   | Briefly losing limits is better than a full outage                                               | `passOnStoreError: true` in `rate-limit.config.ts` |
| Notification emails (queue) | Skip + log  | The action (register, password change) already succeeded                                         | `notify()` in `authentication.service.ts` (ch. 12) |
| Idempotency                 | Fail closed | Running the request without the guarantee could create duplicates, which is what it must prevent | `idempotency.middleware.ts` → 503 (ch. 11)         |

`tryCache` shows the fail-open style:

```ts
private async tryCache<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch (error) {
    logger.warn("User cache unavailable", {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
```

A cache error becomes `null`, which `findById` treats as a miss, so the database answers.

**How to choose:** ask "what is worse: the request failing, or the request running without this component?" If the component only makes things faster or nicer, fail open. If it protects against harm (duplicates, security), fail closed.

After the fix, measured with Redis stopped: `register` answered `201` in about 0.09 s, `profile` `200` in about 1.8 s (the cache timing out, then MySQL), and readiness reported `redis: down` immediately. When Redis came back, everything recovered on its own.

### Running without Redis at all

`REDIS_URL` is optional. Without it, `server.ts` uses `MemoryCache`, in-memory rate limit counters and an inline job queue, and logs:

```
REDIS_URL is not set: cache, rate limits and jobs are in-process only
```

That is fine for one instance on your laptop. It is wrong for several instances, because each would have its own cache and its own rate limit counters.

## Step by step: one profile request with Redis

1. `GET /api/v1/authentication/profile` arrives with a valid token.
2. The controller calls `userService.findById(userId)`.
3. `UserService` calls `repository.findById` → `CachedUserRepository`.
4. Redis `GET cache:user:<id>` → miss the first time.
5. `DrizzleUserRepository` runs `SELECT ... WHERE id = ? AND deleted_at IS NULL`.
6. The user is stored: `SET cache:user:<id> {...} EX 60`.
7. A second profile request within 60 seconds is answered from Redis at step 4.
8. `PATCH /api/v1/users/<id>` runs `UPDATE`, then `DEL cache:user:<id>`.

## Try it yourself

Start everything with Redis configured (`REDIS_URL=redis://127.0.0.1:6379` in `.env`), then:

```bash
# Register and keep the access token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Cache Demo","email":"cache@example.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# Read the profile twice: the first fills the cache, the second hits it
curl -s http://localhost:3000/api/v1/authentication/profile -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:3000/api/v1/authentication/profile -H "Authorization: Bearer $TOKEN"

# See what is in Redis
docker compose exec redis redis-cli --scan
```

You should see keys like:

```
cache:user:0b6c...           # the cached user
rl:global:127.0.0.1          # global rate limit counter
rl:authentication:127.0.0.1  # credential limiter counter
bull:jobs:...                # BullMQ data (chapter 12)
```

Look inside the cached user and its remaining lifetime:

```bash
docker compose exec redis redis-cli GET "cache:user:<paste-id>"
docker compose exec redis redis-cli TTL "cache:user:<paste-id>"   # seconds left, at most 60
```

Then simulate an outage:

```bash
docker compose stop redis
curl -s -w "\n%{http_code} %{time_total}s\n" http://localhost:3000/api/health/live
curl -s http://localhost:3000/api/health/ready
docker compose start redis
```

`live` stays fast; `ready` answers `503` with `"details":{"database":"up","redis":"down"}` until Redis is back.

## Common mistakes

- **Caching without a plan for invalidation.** Every write path must evict, and a TTL must bound what you missed.
- **Caching "not found".** New records stay invisible until the entry expires.
- **Forgetting that JSON loses types.** Dates come back as strings; revive them.
- **Letting the cache take the app down.** A slow or dead cache must degrade to "slower", not "broken". Check client timeouts and retry settings.
- **Using an in-memory cache with several instances.** Each process sees different data.
- **Caching sensitive data carelessly.** Here the cached user contains the password hash; it never leaves the server (the mapper strips it), but do not expose cache contents.

## Summary

- Redis is a fast in-memory key-value store with expiry (`EX`) and atomic "set if absent" (`NX`).
- The boilerplate caches users with **cache-aside**, implemented as a **decorator** (`CachedUserRepository`) around the real repository.
- Writes evict the cached user; a 60-second TTL bounds staleness from writes outside the repository.
- Redis failures must be fast (`maxRetriesPerRequest: 1`, `commandTimeout`) and each caller chooses **fail open** or **fail closed** deliberately.

Next: [11. Idempotency](11-idempotency.md), which uses `setIfAbsent` as a lock.
