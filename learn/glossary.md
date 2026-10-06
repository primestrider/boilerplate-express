# Glossary

Short definitions of the technical terms used in this course, in alphabetical order. Each entry points to the chapter that explains it in depth.

**Access token**: A short-lived credential (here a JWT valid for 15 minutes) that the client sends in the `Authorization: Bearer …` header to prove who it is. See [07. Authentication](07-authentication.md).

**Allowlist**: A list of the values that are explicitly permitted; anything else is rejected. Used for CORS origins, sort fields and accepted file types. See [09. Security](09-security.md).

**API (Application Programming Interface)**: The set of endpoints a program offers to other programs. Here, the HTTP endpoints under `/api`. See [01. The big picture](01-the-big-picture.md).

**API versioning**: Putting a version in the URL (`/api/v1`) so a future incompatible version (`/v2`) can run next to the old one. See [02. HTTP and REST](02-http-and-rest.md).

**Argon2id**: A password hashing algorithm designed to be slow and memory-hungry, which makes guessing passwords expensive for attackers. See [07. Authentication](07-authentication.md).

**AsyncLocalStorage**: A Node.js feature that keeps a value (here the request context) available to every function called during one request, without passing it as a parameter. See [14. Audit log and request context](14-audit-log-and-request-context.md).

**At-least-once delivery**: A queue guarantee that a job runs one or more times, never zero; retries can repeat it, so job handlers must be safe to run twice. See [12. Background jobs and email](12-background-jobs-and-email.md).

**Audit log**: A permanent record of security-relevant actions (who did what, when, from where), separate from the application logs. See [14. Audit log and request context](14-audit-log-and-request-context.md).

**Authentication**: Proving **who** you are (for example with a password or a token). See [07. Authentication](07-authentication.md).

**Authorization**: Deciding **what** an authenticated user may do (for example, only admins may change roles). See [08. Authorization](08-authorization.md).

**Background job**: Work done outside the HTTP request, by a worker process, so the client does not wait for it (sending an email, for example). See [12. Background jobs and email](12-background-jobs-and-email.md).

**Backoff (exponential)**: Waiting longer between each retry (1s, 2s, 4s…) so a struggling service is not hammered. See [12. Background jobs and email](12-background-jobs-and-email.md).

**BullMQ**: A Node.js job queue library that stores jobs in Redis and runs them in worker processes. See [12. Background jobs and email](12-background-jobs-and-email.md).

**Cache**: A fast store holding copies of data that is slower to compute or fetch, to answer repeated requests quickly. See [10. Redis and caching](10-redis-and-caching.md).

**Cache-aside**: A caching pattern where the code first looks in the cache, falls back to the database on a miss, then stores the result in the cache. See [10. Redis and caching](10-redis-and-caching.md).

**Cache invalidation (eviction)**: Removing a cached entry when the underlying data changes, so nobody reads stale data. See [10. Redis and caching](10-redis-and-caching.md).

**CI (Continuous Integration)**: Automatically running checks (lint, types, tests, build) on every push. Here, GitHub Actions. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Composition root**: The single place where all objects are created and connected; here `server.ts` (real dependencies) and `routes.ts` (modules). See [04. Module architecture](04-module-architecture.md).

**Connection pool**: A set of open database connections reused across requests, because opening a new connection per query is slow. See [06. Databases](06-database-mysql-drizzle.md).

**Container**: A packaged, isolated process that includes the app and everything it needs to run; built from an **image**. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Contract test**: The same set of tests run against several implementations of one interface (here `MemoryCache` and `RedisCache`) to prove they behave alike. See [16. Testing](16-testing.md).

**Controller**: The layer that deals with HTTP: reads the request, calls the service, sends the response. See [04. Module architecture](04-module-architecture.md).

**CORS (Cross-Origin Resource Sharing)**: Browser rules that decide whether a web page from one origin may read responses from another origin. See [09. Security](09-security.md).

**Decorator (pattern)**: An object that wraps another object with the same interface to add behaviour, like `CachedUserRepository` adding caching around `DrizzleUserRepository`. See [10. Redis and caching](10-redis-and-caching.md).

**Dependency injection (DI)**: Giving an object the things it needs (through its constructor) instead of letting it create or import them itself, which makes swapping and testing easy. See [04. Module architecture](04-module-architecture.md).

**Docker Compose**: A tool that starts several containers (database, Redis, app…) together from one `docker-compose.yml` file. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**DTO (Data Transfer Object)**: The shape of data as it crosses a boundary (a request body, a response), as opposed to the internal entity. See [04. Module architecture](04-module-architecture.md).

**Drizzle ORM**: The TypeScript library used here to define tables and build type-safe SQL queries. See [06. Databases](06-database-mysql-drizzle.md).

**Entity**: The internal type of a stored record (for example `User`), close to the database shape. See [04. Module architecture](04-module-architecture.md).

**Environment variable (env var)**: A key/value setting given to a process by its environment; used here for all configuration and secrets. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Error code (`errorCode`)**: A stable, machine-readable string in error responses (such as `USER_NOT_FOUND`) that clients can rely on, unlike the human message. See [05. Validation and error handling](05-validation-and-error-handling.md).

**ETag**: A fingerprint of a response; a client sends it back in `If-None-Match` and gets `304 Not Modified` if nothing changed. See [02. HTTP and REST](02-http-and-rest.md).

**Express**: The Node.js web framework this project uses to handle HTTP requests with routes and middleware. See [03. Express and middleware](03-express-and-middleware.md).

**Fail closed**: When a dependency fails, refuse the operation (safer, less available). The idempotency middleware fails closed. See [10. Redis and caching](10-redis-and-caching.md).

**Fail fast**: Stop immediately and loudly when something is wrong (for example invalid configuration at startup), instead of failing later in a confusing way. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Fail open**: When a dependency fails, let the operation continue without it (more available, less protected). The rate limiter and the user cache fail open. See [10. Redis and caching](10-redis-and-caching.md).

**Fake**: A simple working implementation of an interface used in tests instead of the real one (for example a repository backed by an array). See [16. Testing](16-testing.md).

**Fingerprint**: A hash summarizing a request (method, path, body, file) used to detect whether an idempotency key is reused for a different request. See [11. Idempotency](11-idempotency.md).

**Foreign key**: A column that must match a row in another table (for example `files.owner_id` → `users.id`); `ON DELETE CASCADE` deletes child rows with their parent. See [06. Databases](06-database-mysql-drizzle.md).

**Graceful shutdown**: Stopping a server by refusing new work, finishing work in progress, closing connections, then exiting. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Hash (cryptographic)**: A one-way function turning data into a fixed-size fingerprint; you cannot get the original back. Used for passwords (Argon2id) and refresh tokens (SHA-256). See [07. Authentication](07-authentication.md).

**Health check**: An endpoint machines call to know whether the app is alive (`/api/health/live`) and ready to serve traffic (`/api/health/ready`). See [15. Observability](15-observability.md).

**Helmet**: Express middleware that sets security-related HTTP response headers. See [09. Security](09-security.md).

**HTTP status code**: The three-digit number in a response saying what happened (200 OK, 404 Not Found, 500 Internal Server Error…). See [02. HTTP and REST](02-http-and-rest.md).

**`HttpError`**: This project's error class for expected, client-facing errors, carrying a status and an `errorCode`. See [05. Validation and error handling](05-validation-and-error-handling.md).

**Idempotency / idempotent**: An operation is idempotent if doing it twice has the same effect as doing it once. The `Idempotency-Key` header makes non-idempotent requests safe to retry. See [11. Idempotency](11-idempotency.md).

**Index (database)**: A structure that lets the database find rows quickly by a column, like the index at the back of a book. See [06. Databases](06-database-mysql-drizzle.md).

**Integration test**: A test that runs several real pieces together (here: HTTP request → app → real MySQL). See [16. Testing](16-testing.md).

**JWT (JSON Web Token)**: A signed, base64-encoded token containing claims such as the user id and role; the server can verify it without a database lookup. See [07. Authentication](07-authentication.md).

**Keep-alive connection**: An HTTP connection kept open after a response so the next request can reuse it; must be closed explicitly during shutdown. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Liveness vs readiness**: Liveness asks "is the process alive?" (restart if not); readiness asks "can it serve traffic now?" (stop routing to it if not). See [15. Observability](15-observability.md).

**Log level**: How important a log line is (`error`, `warn`, `info`, `debug`…); the logger drops lines below its configured level. See [15. Observability](15-observability.md).

**Magic bytes**: The first bytes of a file that identify its real type (PNG files start with `89 50 4E 47…`). See [13. File uploads](13-file-uploads.md).

**Mapper**: A function that turns an internal entity into a response DTO, leaving out sensitive fields like password hashes. See [04. Module architecture](04-module-architecture.md).

**Middleware**: A function that runs during request handling, can inspect or change the request and response, and either responds or calls `next()`. See [03. Express and middleware](03-express-and-middleware.md).

**Migration**: A versioned SQL file that changes the database schema; applied in order and never edited once applied. See [06. Databases](06-database-mysql-drizzle.md).

**Multipart/form-data**: The request body format browsers use to upload files together with form fields. See [13. File uploads](13-file-uploads.md).

**Multi-stage build**: A Dockerfile with several `FROM` stages, where the final image copies only what it needs from earlier stages. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**OpenAPI**: A standard format describing an HTTP API (endpoints, parameters, schemas); Swagger UI renders it as interactive docs. See [02. HTTP and REST](02-http-and-rest.md).

**ORM (Object-Relational Mapper)**: A library that lets you work with database tables through code instead of writing raw SQL strings. See [06. Databases](06-database-mysql-drizzle.md).

**Pagination**: Returning a long list in pages (`page`, `limit`) with metadata (`total`, `totalPages`) instead of all at once. See [06. Databases](06-database-mysql-drizzle.md).

**Race condition**: A bug where the result depends on the timing of two simultaneous operations (for example, two refreshes using the same token at once). See [06. Databases](06-database-mysql-drizzle.md).

**Rate limiting**: Capping how many requests a client (here, an IP address) may make in a time window, answering 429 beyond it. See [09. Security](09-security.md).

**Redis**: An in-memory key-value store used here for the cache, rate-limit counters, idempotency records and the job queue. See [10. Redis and caching](10-redis-and-caching.md).

**Refresh token**: A long-lived, random, single-use token exchanged for a new access token; stored only as a hash. See [07. Authentication](07-authentication.md).

**Refresh token rotation**: Issuing a new refresh token on every refresh and retiring the old one; reuse of a retired token reveals theft and revokes the session. See [07. Authentication](07-authentication.md).

**Repository**: The layer that talks to the database for one kind of entity, behind an interface the service depends on. See [04. Module architecture](04-module-architecture.md).

**Request context**: Per-request data (request id, IP, user id) available anywhere during that request through `AsyncLocalStorage`. See [14. Audit log and request context](14-audit-log-and-request-context.md).

**Request id**: A unique id for each request, returned in `X-Request-Id` and written in every related log line, used to trace problems. See [15. Observability](15-observability.md).

**REST**: An API style where URLs name resources (`/users/:id`) and HTTP methods say what to do with them (GET, POST, PATCH, DELETE). See [02. HTTP and REST](02-http-and-rest.md).

**Role**: A named set of permissions given to a user (`user` or `admin`). See [08. Authorization](08-authorization.md).

**Schema (database)**: The definition of tables, columns and constraints (`src/db/schema.ts`). See [06. Databases](06-database-mysql-drizzle.md).

**Schema (validation)**: A Zod description of what valid input looks like, used to check and transform request data. See [05. Validation and error handling](05-validation-and-error-handling.md).

**Service**: The layer holding business rules (uniqueness, permissions logic, audit entries), independent of HTTP and SQL. See [04. Module architecture](04-module-architecture.md).

**SIGTERM**: The signal a platform sends to ask a process to stop; it triggers the graceful shutdown. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Soft delete**: Marking a row as deleted (`deletedAt`) instead of removing it, so history and references stay intact. See [06. Databases](06-database-mysql-drizzle.md).

**Structured logging**: Writing logs as JSON objects with named fields so machines can search and filter them. See [15. Observability](15-observability.md).

**Supertest**: A library that sends HTTP requests to an Express app in memory, used in integration tests. See [16. Testing](16-testing.md).

**Timing attack**: Learning secrets by measuring how long the server takes to answer (for example, whether an email exists); prevented here with a dummy hash. See [07. Authentication](07-authentication.md).

**Trust proxy**: The Express setting telling the app how many proxies sit in front of it, so it reads the real client IP from `X-Forwarded-For` without letting clients spoof it. See [09. Security](09-security.md).

**TTL (Time To Live)**: How long a cached value or record is kept before it expires automatically. See [10. Redis and caching](10-redis-and-caching.md).

**Twelve-Factor App**: A set of principles for deployable services, including "store configuration in the environment" and "write logs to stdout". See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Unique constraint**: A database rule that no two rows may share a value in a column (for example `users.email`); the final safety net against duplicates. See [06. Databases](06-database-mysql-drizzle.md).

**Unit test**: A test of one piece of code in isolation, with its dependencies replaced by fakes. See [16. Testing](16-testing.md).

**UUID**: A 128-bit random identifier (like `3f1c…-…`), generated by the app here so ids are known before insertion and cannot be guessed. See [06. Databases](06-database-mysql-drizzle.md).

**Validation**: Checking that incoming data has the right shape and values before using it. See [05. Validation and error handling](05-validation-and-error-handling.md).

**Vitest**: The test runner used in this project. See [16. Testing](16-testing.md).

**Volume (Docker)**: Storage managed by Docker that outlives containers, used for MySQL data, Redis data and uploaded files. See [17. Configuration and deployment](17-configuration-and-deployment.md).

**Worker**: A separate process that takes jobs from the queue and runs them (`src/worker.ts`). See [12. Background jobs and email](12-background-jobs-and-email.md).

**Zod**: The TypeScript library used to define validation schemas and infer types from them. See [05. Validation and error handling](05-validation-and-error-handling.md).

Back to the [course overview](README.md).
