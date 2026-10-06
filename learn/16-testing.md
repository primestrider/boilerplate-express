# 16. Testing

## Goals

By the end of this chapter you will:

- know what unit tests and integration tests are, and why most tests here are integration tests;
- understand how Vitest and Supertest send real HTTP requests to the app without opening a port;
- understand `src/test/create-test-app.ts` in detail: one MySQL database per test worker, cleaned before every test;
- know how **fakes** replace real dependencies, and the shared-object pitfall we actually hit;
- see how the boilerplate tests **failure** paths (database down, Redis down, broken store);
- be able to run the suite and write a new test step by step.

## Core concepts

### Why automated tests?

Every time you change code, something that used to work might break. Clicking through the API by hand after every change is slow and you will forget cases. An automated test is a small program that uses your code and checks the result. You run all of them in seconds with `npm test`, as often as you like, and CI runs them on every push.

A test usually has three parts, often called **Arrange, Act, Assert**:

```ts
it("rejects an email already in use", async () => {
  // Arrange: set up the situation
  const { accessToken } = await registerUser(app, { email: "me@x.com" });
  await registerUser(app, { email: "admin@x.com" });

  // Act: do the thing being tested
  const res = await request(app)
    .patch(`/api/v1/users/${id}`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ email: "admin@x.com" });

  // Assert: check the result
  expect(res.status).toBe(409);
});
```

### Unit tests vs integration tests

| Unit test                                                        | Integration test                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Tests one piece (a function, a class) in isolation               | Tests several pieces working together                                      |
| Dependencies are replaced by fakes                               | Uses real dependencies (here: a real MySQL database)                       |
| Very fast (milliseconds), no setup                               | Slower (a database round trip per query)                                   |
| Good for logic with many cases (`UserService`, `detectMimeType`) | Good for "does the endpoint really work?" (routing, validation, SQL, auth) |

The **test pyramid** says: have many small fast tests at the bottom and fewer big slow ones at the top.

```
            /\
           /E2E\        few: full system, browser or deployed stack
          /------\
         /  inte- \     many here: HTTP request -> app -> real MySQL
        / gration  \
       /------------\
      /    unit      \  fast checks of pure logic with fakes
     /----------------\
```

In a backend like this one, most bugs live in the **seams**: a wrong SQL condition, a middleware in the wrong order, a validation schema that does not match what the controller expects. Unit tests with fakes cannot see those, so this boilerplate leans on integration tests, and uses unit tests where the logic is rich (services, file type detection, cache behaviour, idempotency edge cases).

### Fakes

A **fake** is a simple working implementation of an interface, used instead of the real one in tests. For example, a fake repository keeps users in an array instead of MySQL. Because services depend on **interfaces** (see [chapter 4](04-module-architecture.md)), swapping the real thing for a fake requires no change to the service.

## In this boilerplate

### The tools

- **[Vitest](https://vitest.dev/)** runs the tests (`describe`, `it`, `expect`, hooks like `beforeEach`). Configuration lives in `vitest.config.mts`.
- **[Supertest](https://github.com/ladjs/supertest)** sends HTTP requests to an Express app **in memory**: `request(app).get("/api/health/live")`. No port is opened and no server needs to be started.

`vitest.config.mts` sets the environment variables the app needs in tests:

```ts
env: {
  NODE_ENV: "test",
  CORS_ORIGIN: "*",
  TRUST_PROXY: "0",
  RATE_LIMIT_MAX: "1000",
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "mysql://root:root@127.0.0.1:3306/app_test",
  JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
  ...
},
hookTimeout: 30_000,
```

`NODE_ENV: "test"` also silences the logger ([chapter 15](15-observability.md)). `RATE_LIMIT_MAX` is high so tests that send many requests do not hit the global limiter. `hookTimeout` is raised because creating and migrating a database in a hook can take a few seconds on the first run.

### `src/test/create-test-app.ts` in depth

This file is the heart of the integration tests. Its job: give every test a fully working app on a **clean, real database**.

#### 1. One database per Vitest worker

Vitest runs test **files** in parallel, in several worker processes. If they all shared one database, a test in `users.test.ts` could delete rows that a test in `files.test.ts` is using at the same moment. So each worker gets its own database:

```ts
const testDatabaseUrl = (() => {
  const url = new URL(env.DATABASE_URL);
  url.pathname = `${url.pathname}_${process.env.VITEST_POOL_ID ?? "0"}`;
  return url.toString();
})();
```

Vitest sets `VITEST_POOL_ID` to a different number in each worker, so `.../app_test` becomes `.../app_test_1`, `.../app_test_2`, and so on.

#### 2. Create and migrate once

```ts
let database: Promise<DB> | undefined;

const getDatabase = () =>
  (database ??= (async () => {
    ...
    const admin = await mysql.createConnection(url.toString());
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``);
    await admin.end();

    const db = createDatabase(testDatabaseUrl);
    await migrate(db, { migrationsFolder: "drizzle" });
    return db;
  })());
```

- `??=` assigns only if `database` is still `undefined`, so the work happens once and every later call reuses the same promise.
- It connects **without** a database name to run `CREATE DATABASE IF NOT EXISTS`, then applies the real migrations from `drizzle/`. The tests therefore always run against the same schema as production.
- Migrations are recorded in a table, so running `migrate` again (for the next test file in the same worker) only applies new ones; it is fast.

An `afterAll` hook closes the connection pool when a test file finishes, so the worker does not hang on open connections:

```ts
afterAll(async () => {
  await (await database)?.$client.end();
  database = undefined;
});
```

#### 3. A clean slate on every `createTestApp()`

```ts
export const createTestApp = async (config: Partial<Env> = {}) => {
  const db = await getDatabase();

  // Children before parents (foreign keys).
  for (const table of [files, refreshTokens, auditLogs, users]) {
    await db.delete(table);
  }
```

Every call empties the tables, so a test never sees rows from the previous one. The order matters: `files` and `refresh_tokens` reference `users` with foreign keys, so children are deleted first.

#### 4. In-memory replacements for Redis-backed services

```ts
  const jobQueue = new RecordingJobQueue();
  const storage = new LocalFileStorage(
    mkdtempSync(path.join(tmpdir(), "boilerplate-uploads-")),
  );

  const app = createApp({
    db,
    config: { ...env, ...config },
    redis: undefined,
    cache: new MemoryCache(),
    jobQueue,
    storage,
  });

  return { app, db, jobQueue, storage };
};
```

- `redis: undefined`: tests do not need Redis; the rate limiters fall back to memory and the readiness check skips Redis.
- `MemoryCache`: a fresh cache per app, so cached users never leak between tests.
- `RecordingJobQueue`: instead of running jobs, it **records** them so a test can assert "a welcome email was queued":

  ```ts
  export class RecordingJobQueue implements JobQueue {
    readonly jobs: { name: JobName; data: JobPayloads[JobName] }[] = [];

    async add<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
      this.jobs.push({ name, data });
    }
  ```

- `LocalFileStorage` points at a new temporary directory, so uploads from tests never land in your real `uploads/` folder.
- `config` can override any env value for one test, e.g. `createTestApp({ UPLOAD_MAX_BYTES: 1024 })` in `files.test.ts` or `createTestApp({ NODE_ENV: "production", ... })` in `docs.test.ts`.

This is the payoff of the **app factory** design ([chapter 3](03-express-and-middleware.md) and [chapter 4](04-module-architecture.md)): `createApp` receives everything from outside, so tests can hand it different pieces.

#### 5. Helpers: `registerUser` and `registerAdmin`

```ts
export const registerUser = async (app, overrides = {}) => {
  const res = await request(app)
    .post("/api/v1/authentication/register")
    .send({
      name: "Ricky",
      email: "r@x.com",
      password: DEFAULT_PASSWORD,
      ...overrides,
    });

  if (res.status !== 201) {
    throw new Error(
      `register failed: ${res.status} ${JSON.stringify(res.body)}`,
    );
  }

  return res.body.data;
};
```

It registers through the **real API** (so registration is exercised too) and returns the user plus tokens. `registerAdmin` registers a user, sets `role = 'admin'` directly in the database, and logs in again so the new access token carries the admin role.

### Unit tests with fakes: `src/modules/users/user.service.test.ts`

`UserService` needs a `UserRepository` and an `AuditService`. The test builds both without a database:

```ts
const createFakeRepository = (seed: User[] = []): UserRepository => {
  const users = seed.map((user) => ({ ...user }));
  const live = () => users.filter((u) => u.deletedAt === null);
  const find = (id: string) => live().find((u) => u.id === id) ?? null;

  return {
    findById: async (id) => find(id),
    isEmailTaken: async (email, exceptUserId) =>
      users.some((u) => u.email === email && u.id !== exceptUserId),
    softDelete: async (id) => { ... },
    ...
  };
};

const createService = (seed: User[] = []) => {
  const audit: NewAuditLog[] = [];
  const auditService = new AuditService({
    create: async (entry) => {
      audit.push(entry);
    },
    findAll: async () => ({ logs: [], total: 0 }),
  });

  return { service: new UserService(createFakeRepository(seed), auditService), audit };
};
```

The **real** `AuditService` is used, but with a fake **repository** that pushes entries into an array, so a test can check exactly what was recorded:

```ts
expect(audit[0]).toMatchObject({
  action: "user.role_changed",
  metadata: { from: "user", to: "admin" },
});
```

#### The shared-seed-object pitfall (a bug we really hit)

The first version of the fake did `const users = [...seed];`. That copies the **array**, but the user **objects** inside are still the same objects as the `existing` constant shared by all tests. One test changed `existing.role` to `"admin"` through the fake, and a later test that expected `"user"` failed: tests were leaking state into each other.

```
seed array  ──copy──▶  users array      (new array)
   │                      │
   └──▶ { id: "1", role } ◀┘            (SAME object!)
```

The fix copies each object: `seed.map((user) => ({ ...user }))`. Lesson: when a fake stores data, copy it, the way a real database would.

### Contract tests: `src/shared/cache/cache.test.ts`

There are two `Cache` implementations, `MemoryCache` and `RedisCache`. They must behave the same, otherwise tests (which use memory) would not reflect production (which uses Redis). So the same tests run against both:

```ts
const behavesLikeACache = (create: () => Cache) => {
  it("setIfAbsent stores only once", async () => {
    const cache = create();

    expect(await cache.setIfAbsent("once", 1, 10)).toBe(true);
    expect(await cache.setIfAbsent("once", 2, 10)).toBe(false);
    expect(await cache.get("once")).toBe(1);
  });
  ...
};

describe("MemoryCache", () => {
  behavesLikeACache(() => new MemoryCache());
  ...
});

describe.skipIf(!redisUrl)("RedisCache", () => {
  ...
  behavesLikeACache(() => new RedisCache(redis!, `test:${randomUUID()}:`));
});
```

- A function that registers tests (`behavesLikeACache`) is called once per implementation; this is often called a **contract test**.
- `describe.skipIf(!redisUrl)` skips the Redis suite unless `TEST_REDIS_URL` is set, so `npm test` works without Redis, while CI (which sets it) checks the real thing.
- Each Redis test uses a random key prefix, so runs never collide and nothing needs to be flushed.

The memory-only expiry test uses **fake timers** to jump forward in time instead of really waiting 10 seconds:

```ts
vi.useFakeTimers({ toFake: ["Date"] });
await cache.set("k", 1, 10);
vi.setSystemTime(Date.now() + 11_000);
expect(await cache.get("k")).toBeNull();
```

### Testing failure paths

Happy paths are easy. The bugs that hurt in production are in failure paths, so the boilerplate tests them deliberately.

**Database and Redis down** (`src/modules/health/health.test.ts`):

```ts
const db = createTestDatabase();
await db.$client.end();                       // a pool that is already closed
// Nothing listens on port 1, so the Redis check fails too.
const redis = new Redis("redis://127.0.0.1:1", {
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
redis.on("error", () => {});

const app = createApp({ db, config: env, redis, cache: new MemoryCache(), ... });
const res = await request(app).get("/api/health/ready");

expect(res.status).toBe(503);
expect(res.body.errorCode).toBe("DEPENDENCY_UNAVAILABLE");
expect(res.body.details).toEqual({ database: "down", redis: "down" });
```

It uses `createTestDatabase()` (a **separate** pool) so closing it does not break the shared pool used by other tests. This test is also how we discovered that the Redis rate-limit store turned every request into a 500 when Redis was down; the fix was `passOnStoreError` ([chapter 10](10-redis-and-caching.md)).

**A broken idempotency store** (`src/shared/middlewares/idempotency.middleware.test.ts`) builds a tiny Express app with a `Cache` whose every method rejects, and checks that a request with an `Idempotency-Key` gets a retryable 503 while a request without one still succeeds. The same file tests the "still in progress" case by holding the first request open with a promise and sending a second one meanwhile.

## Step by step

### What happens when you run `npm test`

```mermaid
sequenceDiagram
  participant V as Vitest
  participant W as Worker N
  participant T as Test file
  participant DB as MySQL (app_test_N)
  V->>W: start workers, one test file each at a time
  W->>T: import file (imports create-test-app.ts)
  T->>DB: first createTestApp(): CREATE DATABASE IF NOT EXISTS, migrate
  loop every test
    T->>DB: createTestApp(): delete rows from all tables
    T->>T: request(app)... expect(...)
  end
  T->>DB: afterAll: close the pool
```

### Writing a new integration test

Suppose you want to check that a user can read their own profile after changing their name.

1. **Pick the file.** Tests live next to the code: `src/modules/users/users.test.ts`.
2. **Arrange** with the helpers:

   ```ts
   it("shows the new name on the profile", async () => {
     const { app } = await createTestApp();
     const { accessToken, user } = await registerUser(app);
   ```

3. **Act** with Supertest:

   ```ts
   await request(app)
     .patch(`/api/v1/users/${user.id}`)
     .set("Authorization", `Bearer ${accessToken}`)
     .send({ name: "New Name" });

   const res = await request(app)
     .get("/api/v1/authentication/profile")
     .set("Authorization", `Bearer ${accessToken}`);
   ```

4. **Assert** on status and body:

   ```ts
     expect(res.status).toBe(200);
     expect(res.body.data.name).toBe("New Name");
   });
   ```

5. **Run only that file** while working: `npx vitest run src/modules/users/users.test.ts`, or `npm run test:watch` to rerun on save.
6. **Make it fail once on purpose** (for example expect `"Wrong"`) to be sure the test really checks something.

## Try it yourself

```bash
# 1. MySQL must be running (tests create app_test_<n> databases with the root user)
docker compose up -d mysql

# 2. Run everything
npm test
#  Test Files  13 passed (13)
#       Tests  115 passed | 3 skipped (118)   <- the 3 Redis cache tests are skipped

# 3. Include the real Redis tests (database 15 keeps them away from dev data)
docker compose up -d redis
TEST_REDIS_URL=redis://127.0.0.1:6379/15 npm test
#       Tests  118 passed (118)

# 4. One file, in watch mode
npx vitest src/modules/files/files.test.ts

# 5. Peek at the per-worker databases
docker compose exec mysql mysql -uroot -proot -e "SHOW DATABASES LIKE 'app_test%'"
```

Exact counts change as tests are added; what matters is "all passed".

## Common mistakes

- **Sharing state between tests.** A module-level variable, a reused object (the seed pitfall above) or a shared database without cleanup makes tests pass or fail depending on order. Each test should create what it needs.
- **Mocking everything.** If the database, validation and routing are all mocked, the test proves only that your mocks agree with each other. Prefer real dependencies for integration tests and fakes with real behaviour for unit tests.
- **Using SQLite in tests and MySQL in production.** Different databases differ in SQL dialect, case sensitivity and constraints. The boilerplate tests against MySQL for that reason.
- **Testing only the happy path.** Check the 400s, 401s, 403s, 404s and 409s, and what happens when a dependency is down.
- **Asserting on log output.** Logs are for humans; assert on responses and stored data instead (the logger is silent in tests).
- **Real sleeps.** `setTimeout(…, 10_000)` makes the suite slow. Use fake timers, as the cache test does.
- **Forgetting to close connections.** Open pools keep workers alive; the `afterAll` in `create-test-app.ts` handles it.

## Summary

- Most tests are integration tests: Supertest sends real HTTP requests to the app, which talks to a real, migrated MySQL database.
- Each Vitest worker gets its own database (`VITEST_POOL_ID`), migrated once and emptied on every `createTestApp()`.
- Redis-backed pieces are replaced by `MemoryCache`, `RecordingJobQueue` and a temporary upload directory; `config` can be overridden per test.
- Unit tests use fakes behind the same interfaces; copy data in fakes to avoid shared-object bugs.
- Contract tests run the same checks against memory and Redis implementations; `describe.skipIf` keeps Redis optional.
- Failure paths (dead database, dead Redis, broken store) are tested on purpose, and they found real bugs.

Next: [17. Configuration and deployment](17-configuration-and-deployment.md)
