# 17. Configuration and Deployment

## Goals

By the end of this chapter you will:

- understand why configuration lives in environment variables (the 12-factor idea);
- know how `src/config/env.ts` validates configuration with Zod, including two real bugs it guards against;
- be able to read the `Dockerfile` and `docker-compose.yml` line by line;
- understand graceful shutdown, and the difference between `uncaughtException` and `unhandledRejection`;
- know what the CI pipeline checks;
- know what changes when you run more than one instance, and have a production checklist.

## Core concepts

### Configuration vs code

**Code** is the same everywhere. **Configuration** is what differs between environments: the database address on your laptop is not the one in production, and the production JWT secret must never be in Git.

The [Twelve-Factor App](https://12factor.net/config) method says: keep configuration in **environment variables** (env vars), not in files committed with the code. Env vars are key/value strings the operating system gives to a process:

```bash
PORT=3000 DATABASE_URL=mysql://... node dist/server.js
```

Benefits: the same build (the same Docker image) runs everywhere, only the env changes; secrets stay out of Git; every platform (Docker, Kubernetes, Heroku, systemd) knows how to set env vars.

### Fail fast

A misconfigured app should **refuse to start**, loudly, rather than start and fail later in a confusing way (for example, the first time someone logs in). Validating all configuration at startup is the "fail fast" principle.

### Containers

A **container** packages your app with everything it needs (Node.js, `node_modules`, the compiled code) into an **image**. The image runs the same on your laptop, in CI and on a server. **Docker** builds and runs images; **Docker Compose** starts several containers (app, database, Redis…) together from one file.

### Graceful shutdown

Servers are stopped all the time: deployments, scaling down, restarts. The platform sends the process a **signal**, usually `SIGTERM` ("please stop"), and kills it with `SIGKILL` if it has not exited after a grace period. A graceful shutdown uses that window to finish what is in progress instead of cutting requests off mid-way. Think of a shop closing: lock the door to new customers, serve those already inside, then switch off the lights.

## In this boilerplate

### `src/config/env.ts`

The whole configuration is one Zod schema, parsed once at startup:

```ts
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    `Invalid environment variables: ${JSON.stringify(
      parsedEnv.error.flatten().fieldErrors,
    )}`,
  );
}

export type Env = z.infer<typeof envSchema>;

export const env: Env = parsedEnv.data;
```

Every other file imports the typed `env` object instead of reading `process.env` directly. Benefits: values are already converted (`PORT` is a `number`, not the string `"3000"`), defaults are applied, and TypeScript knows exactly which keys exist.

`dotenv.config({ quiet: true })` at the top loads a local `.env` file into `process.env` first (if one exists). Real env vars win over `.env` values.

Some notable fields:

```ts
// Required on purpose: defaulting to "development" would leak error
// details on a production server that forgot to set NODE_ENV.
NODE_ENV: z.enum(["development", "test", "production"]),
PORT: z.coerce.number().int().positive().default(3000),
// mysql://user:password@host:3306/database
DATABASE_URL: z.url({ protocol: /^mysql$/ }),
REDIS_URL: optional(z.url({ protocol: /^rediss?$/ })),
JWT_SECRET: z.string().min(32),
```

- `NODE_ENV` has **no default**. The error middleware adds stack traces to 500 responses outside production; if a forgotten `NODE_ENV` silently defaulted to `development`, a production server would leak them.
- `z.coerce.number()` turns the string from the environment into a number, and rejects `PORT=abc`.
- `DATABASE_URL` must be a URL with the `mysql` protocol; a typo like `mysq://` stops the app at startup.
- `JWT_SECRET` must be at least 32 characters; a short secret could be brute-forced ([chapter 7](07-authentication.md)).

#### The empty-value bug and `optional()`

`.env.example` contains lines like `SMTP_HOST=` (empty). `dotenv` turns that into the empty string `""`, **not** "unset". The first version used `z.string().min(1).optional()`, so `""` failed `min(1)` and the app refused to start. We only noticed when the migrate container crashed in Docker with:

```
Invalid environment variables: {"SMTP_HOST":["Too small: expected string to have >=1 characters"], ...}
```

The fix is a small helper:

```ts
/** An optional variable; an empty value (`SMTP_HOST=`) counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );
```

`z.preprocess` runs before validation and turns `""` into `undefined`, which `.optional()` accepts. It is used for `REDIS_URL`, `SMTP_HOST`, `SMTP_USER` and `SMTP_PASS`.

#### Cross-field rules with `refine`

```ts
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

A rule that involves two fields cannot live on one field, so it is a `refine` on the whole object: in production, `CORS_ORIGIN=*` is refused ([chapter 9](09-security.md)).

### `.env` vs `.env.example`

| File           | Committed?            | Contains                                              |
| -------------- | --------------------- | ----------------------------------------------------- |
| `.env.example` | Yes                   | Every variable, with safe example values and comments |
| `.env`         | **No** (`.gitignore`) | Your real local values, including `JWT_SECRET`        |

New developers copy the example (`cp .env.example .env`) and fill in secrets. When you add a variable to `env.ts`, add it to `.env.example` and to the README's table too.

### The `Dockerfile`, line by line

The Dockerfile has two **stages**. The first builds; the second is the small image that actually runs.

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build
```

- `node:24-alpine` is Node 24 on Alpine Linux, a very small base image.
- `npm ci` installs **exactly** what `package-lock.json` says (including dev dependencies like TypeScript, needed to build).
- Copying `package*.json` **before** the source is a caching trick: Docker caches each step, so as long as dependencies do not change, `npm ci` is not re-run when you only edit code.
- `npm run build` compiles TypeScript into `dist/`.

```dockerfile
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
```

- A fresh stage: nothing from `build` comes along unless copied explicitly.
- `npm ci --omit=dev` installs only runtime dependencies. TypeScript, Vitest, ESLint and drizzle-kit stay out, so the image is smaller and has less attack surface.
- Only the compiled `dist/` is copied from the build stage, plus the `drizzle/` migration files (needed by `dist/db/migrate.js`, which uses the runtime driver instead of drizzle-kit for exactly this reason).

```dockerfile
# The upload volume is mounted here; it must be writable by the app user.
RUN mkdir uploads && chown node:node uploads
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
```

- `USER node` runs the app as the unprivileged `node` user that the official image provides, not as `root`. If an attacker ever got code execution, they would not be root inside the container.
- `uploads/` is created and handed to `node` before switching user, because a Docker volume mounted there inherits that ownership.
- `CMD` runs the API. The worker and the migration use the same image with a different command.

`.dockerignore` keeps `node_modules`, `dist`, `.env`, `.git` and `uploads` out of the build context, so local files (and your secrets) never end up in the image.

### `docker-compose.yml`

Two ways to use it, as its header says:

```yaml
# Local development:   docker compose up -d mysql redis   (then npm run dev)
# Full stack:          docker compose up -d --build
```

The services:

```mermaid
flowchart LR
  mysql[(mysql)] -- healthy --> migrate[migrate: run once]
  migrate -- completed successfully --> app[app :3000]
  migrate -- completed successfully --> worker
  redis[(redis)] -- healthy --> app
  redis -- healthy --> worker
```

**mysql** and **redis** have a `healthcheck`, a command Docker runs repeatedly to decide whether the container is "healthy":

```yaml
healthcheck:
  test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-proot"]
  interval: 5s
  timeout: 5s
  retries: 20
```

Their ports are bound to `127.0.0.1`, so they are reachable from your machine but not from your network. Data lives in named **volumes** (`mysql-data`, `redis-data`) and survives container restarts.

**migrate** is a one-shot job: it runs `node dist/db/migrate.js` and exits.

```yaml
depends_on:
  mysql:
    condition: service_healthy
```

It waits until MySQL is **healthy**, not merely started (MySQL needs several seconds before it accepts connections).

**app** and **worker** wait for migrate to finish:

```yaml
depends_on:
  migrate:
    condition: service_completed_successfully
  redis:
    condition: service_healthy
```

`service_completed_successfully` means "exited with code 0". If a migration fails, the app never starts against a half-migrated schema.

**Configuration in containers:**

```yaml
env_file:
  - path: .env
    required: false
# Container hostnames; everything else comes from .env.
environment: &container-env
  DATABASE_URL: mysql://app:app@mysql:3306/app
  REDIS_URL: redis://redis:6379
```

- `env_file` loads your `.env`; `required: false` lets `docker compose up -d mysql redis` work before you created one.
- `environment` **overrides** two values: inside the Compose network, MySQL is reachable at host `mysql`, not `127.0.0.1` (which would be the container itself).
- `&container-env` defines a YAML **anchor** and `*container-env` reuses it, so the three services share one definition.
- `NODE_ENV` is deliberately not forced here: your `.env` decides. Forcing `production` broke local use, because `.env.example` has `CORS_ORIGIN=*`, which production mode rejects.

The `uploads` volume is mounted at `/app/uploads` in the app container, so uploaded files survive container rebuilds.

### Graceful shutdown: `src/server.ts`

```ts
const shutdown = (reason: string, exitCode = 0) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${reason} received. Shutting down gracefully...`);

  setTimeout(() => {
    logger.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close((error) => {
    closeResources()
      ...
      .finally(() => {
        logger.info("Process terminated");
        process.exit(error ? 1 : exitCode);
      });
  });

  // Idle keep-alive sockets would otherwise hold server.close() open.
  server.closeIdleConnections();
};
```

In order:

1. `isShuttingDown` makes a second signal (pressing Ctrl+C twice) harmless.
2. A 10-second safety timer forces an exit if something hangs. `.unref()` means the timer itself does not keep the process alive.
3. `server.close(...)` stops accepting new connections and calls back once all in-flight requests have finished.
4. `server.closeIdleConnections()` closes **keep-alive** connections that are open but idle. Browsers and proxies keep connections open for reuse; without this, `server.close` would wait for them.
5. Then `closeResources()` runs:

   ```ts
   const closeResources = async () => {
     await jobQueue.close();
     await Promise.all([db.$client.end(), redis?.quit()]);
   };
   ```

   The queue first (the inline queue waits for jobs already running), then MySQL and Redis together. Order matters: closing the database before the queue finished could fail a job mid-way.

The **worker** (`src/worker.ts`) has its own, simpler shutdown: `await worker.close()` waits for jobs currently running; jobs not yet started stay in Redis for another worker.

### `uncaughtException` vs `unhandledRejection`

```ts
process.on("uncaughtException", (error) => {
  // State may be corrupted, so exit immediately instead of draining.
  logger.error("Uncaught exception", { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { ... });
  shutdown("unhandledRejection", 1);
});
```

- An **uncaught exception** is a synchronous `throw` nobody caught. The process may now be in an inconsistent state (half-updated variables), so it exits **immediately**; the platform restarts it.
- An **unhandled rejection** is a rejected promise nobody handled. It is usually a forgotten `await` or `.catch`, so the process exits through the graceful path, finishing other requests first, and with exit code 1 so the platform sees a failure.

Errors inside request handlers never reach these: Express 5 sends them to the error middleware ([chapter 5](05-validation-and-error-handling.md)).

### CI: `.github/workflows/ci.yml`

GitHub Actions runs on every push to `main` and every pull request. The `check` job:

```yaml
strategy:
  matrix:
    node: [22, 24]
services:
  mysql:
    image: mysql:8.4
    ...
  redis:
    image: redis:7-alpine
    ...
env:
  TEST_DATABASE_URL: mysql://root:root@127.0.0.1:3306/app_test
  TEST_REDIS_URL: redis://127.0.0.1:6379/15
```

- The **matrix** runs the whole job twice, on Node 22 and Node 24 (`engines` in `package.json` promises 22.12+).
- **Service containers** start MySQL and Redis next to the job, the CI equivalent of `docker compose up -d mysql redis`. `TEST_REDIS_URL` makes the Redis contract tests run too.

The steps, in order: `npm ci` → `format:check` → `lint` → `typecheck` → `test` → `build` → `npm audit --audit-level=high`. Cheap checks come first so a formatting slip fails in seconds.

A second job, `docker`, runs `docker build`, so a broken `Dockerfile` is caught before deployment.

## Step by step

### Deploying a new version (typical flow)

```
git push ──▶ CI: format, lint, typecheck, test (MySQL+Redis), build, audit, docker build
                │ all green
                ▼
        build & push the image
                │
                ▼
        run the migrate job (node dist/db/migrate.js) ── fails? stop here
                │ exit 0
                ▼
        start new app/worker containers ── /api/health/ready = 200? route traffic to them
                │
                ▼
        SIGTERM old containers ── graceful shutdown, exit 0
```

### Scaling to several instances

One instance is simple. With two or more behind a load balancer, anything kept **in process memory** stops being shared:

| Concern                   | One instance                | Several instances                                                             |
| ------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| Rate limits               | Memory store is fine        | Set `REDIS_URL`, or each instance counts separately (limit × N)               |
| User cache                | `MemoryCache` is fine       | `REDIS_URL`, or one instance serves stale data after another updates it       |
| Idempotency               | Memory is fine              | `REDIS_URL`, or a retry hitting another instance runs the action twice        |
| Background jobs           | Inline queue works          | `REDIS_URL` + one or more `worker` processes                                  |
| Uploaded files            | `LocalFileStorage` is fine  | A shared `FileStorage` (implement S3/GCS), or files exist on one machine only |
| Client IP (limits, audit) | `TRUST_PROXY` = proxy count | Same; set it to the real number of proxies in front                           |

Workers scale independently: run as many `worker` containers as the job load needs; BullMQ hands each job to exactly one of them.

## Try it yourself

```bash
# 1. Watch fail-fast in action: an invalid PORT (the other values come from .env;
#    variables set on the command line win over .env)
NODE_ENV=development PORT=abc npx tsx src/server.ts
# Error: Invalid environment variables: {"PORT":["Invalid input: expected number, received NaN"]}

# 2. Production refuses CORS_ORIGIN=*
NODE_ENV=production CORS_ORIGIN='*' DATABASE_URL=mysql://a:b@h/d \
  JWT_SECRET=0123456789012345678901234567890123 npx tsx src/server.ts
# Error: Invalid environment variables: {"CORS_ORIGIN":["CORS_ORIGIN must list explicit origins in production"]}

# 3. Run the whole stack in Docker (needs a .env with JWT_SECRET)
docker compose up -d --build
docker compose ps                    # migrate: Exited (0), app/worker: Up
curl -s http://localhost:3000/api/health/ready

# 4. Graceful shutdown
docker compose stop app worker
docker compose logs app worker | grep -E "SIGTERM|terminated|Finishing"
# "SIGTERM received. Shutting down gracefully..."
# "Process terminated"
# "SIGTERM received. Finishing active jobs..."
docker compose ps -a                 # app and worker: Exited (0)

# Back to local development
docker compose up -d mysql redis
```

## Common mistakes

- **Reading `process.env` all over the code.** No validation, no types, no single list of what the app needs. Go through `env`.
- **Defaults for secrets or for `NODE_ENV`.** A default JWT secret ends up in production one day. Make dangerous values required.
- **Committing `.env`.** Once a secret is in Git history, treat it as leaked and rotate it.
- **Treating an empty env var as a value.** `KEY=` is `""`, not "missing"; see the `optional()` helper.
- **Running containers as root** and **shipping dev dependencies** in the runtime image.
- **`depends_on` without a condition.** "Started" is not "ready"; use `service_healthy` / `service_completed_successfully`.
- **Running migrations from every app instance at startup.** Several instances race on the same migration. A single migrate step before the rollout avoids that.
- **No graceful shutdown.** Every deployment then cuts off in-flight requests and jobs.
- **Scaling out with in-memory state.** See the table above.

## Production checklist

- [ ] `NODE_ENV=production`, explicit `CORS_ORIGIN` list, strong random `JWT_SECRET` (rotating it logs everyone out).
- [ ] Database user with only the privileges it needs; MySQL backups enabled and restores tested.
- [ ] `REDIS_URL` set if more than one instance, and at least one `worker` running.
- [ ] `TRUST_PROXY` equal to the real number of proxies; HTTPS terminated at the proxy/load balancer.
- [ ] Shared file storage if more than one instance.
- [ ] SMTP configured (`SMTP_HOST`, credentials, a real `MAIL_FROM`).
- [ ] Migrations run as a separate step before new containers start.
- [ ] Liveness and readiness probes pointed at `/api/health/live` and `/api/health/ready`.
- [ ] Logs collected from stdout into a searchable platform; alerts on 5xx rate.
- [ ] The first admin promoted with `node dist/cli/make-admin.js <email>`.
- [ ] `npm audit` clean, base image updated regularly.

## Summary

- Configuration comes from env vars, validated once at startup by a Zod schema in `src/config/env.ts`; invalid config stops the app immediately.
- `optional()` treats empty values as unset, and `refine` enforces cross-field rules such as "no `*` CORS in production".
- The multi-stage `Dockerfile` builds with dev dependencies, then ships only runtime dependencies, compiled code and migrations, running as the `node` user.
- Compose starts MySQL and Redis, waits for them to be healthy, runs migrations once, then starts the app and the worker.
- Graceful shutdown stops new connections, finishes in-flight work, closes the queue, MySQL and Redis, and has a timeout.
- CI checks formatting, lint, types, tests against real MySQL and Redis on two Node versions, the build, dependencies and the Docker image.
- More than one instance requires Redis and shared file storage.

Next: [18. Exercise: build a new module](18-exercise-build-a-module.md)
