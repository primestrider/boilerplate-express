# Learning Backend Development with This Boilerplate

This folder is a **step-by-step course** in backend development, from the most basic ideas to deployment. Each chapter explains a concept in general terms, then shows **where and how** this boilerplate applies it, so you can read the theory and the real code side by side.

## Who is this for?

- You know basic JavaScript/TypeScript (variables, functions, `async/await`, classes).
- You may or may not have built an API before, and you want to understand **why** a "production-ready" backend is built this way, not just **how**.

You do not need prior knowledge of Express, SQL, Redis or Docker; each is explained from the start.

## How to use this material

1. **Read in order.** Chapters build on each other; chapter 7 (authentication) uses ideas from chapters 4–6.
2. **Open the code.** Whenever a file is mentioned (for example `src/app.ts`), open it in your editor and read along. The comments in the code explain things too.
3. **Run the "Try it yourself" sections.** Sending a request and seeing the response yourself sticks far better than only reading.
4. **Do the exercise in the last chapter**: build a new module from scratch using the same patterns.

## Setup (once)

```bash
npm install
cp .env.example .env            # then fill in JWT_SECRET (see the main README)
docker compose up -d mysql redis
npm run db:migrate
npm run dev                     # API at http://localhost:3000
```

Swagger UI (interactive documentation) is at http://localhost:3000/api/docs; you can try every endpoint from the browser.

## Roadmap

| #   | Chapter                                                              | What you will learn                                                          |
| --- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 01  | [The big picture](01-the-big-picture.md)                             | What a backend is, the journey of a request, the project's folder map        |
| 02  | [HTTP and REST APIs](02-http-and-rest.md)                            | Methods, status codes, headers, endpoint design, versioning, response shape  |
| 03  | [Express and middleware](03-express-and-middleware.md)               | How Express works, the middleware chain, the order in `app.ts`               |
| 04  | [Module architecture](04-module-architecture.md)                     | Routes → controller → service → repository, dependency injection             |
| 05  | [Validation and error handling](05-validation-and-error-handling.md) | Zod, `validate`, `HttpError`, the error middleware                           |
| 06  | [Databases: MySQL and Drizzle](06-database-mysql-drizzle.md)         | Tables, migrations, connection pool, queries, pagination, soft delete, races |
| 07  | [Authentication](07-authentication.md)                               | Password hashing, JWT, refresh token rotation, token theft detection         |
| 08  | [Authorization](08-authorization.md)                                 | Roles, `requireRole`, resource ownership, 401 vs 403 vs 404                  |
| 09  | [Application security](09-security.md)                               | Helmet, CORS, rate limiting, trust proxy, body limits, secrets               |
| 10  | [Redis and caching](10-redis-and-caching.md)                         | Redis, cache-aside, invalidation, TTL, fail open vs fail closed              |
| 11  | [Idempotency](11-idempotency.md)                                     | Safe retries, `Idempotency-Key`, fingerprints, edge cases                    |
| 12  | [Background jobs and email](12-background-jobs-and-email.md)         | Queues, workers, retries and backoff, BullMQ, nodemailer                     |
| 13  | [File uploads](13-file-uploads.md)                                   | Multipart, magic bytes, storage, streaming downloads                         |
| 14  | [Audit log and request context](14-audit-log-and-request-context.md) | Audit trails, `AsyncLocalStorage`                                            |
| 15  | [Observability](15-observability.md)                                 | Structured logging, request ids, health checks                               |
| 16  | [Testing](16-testing.md)                                             | Unit vs integration tests, Vitest, Supertest, fakes, test databases          |
| 17  | [Configuration and deployment](17-configuration-and-deployment.md)   | Env vars, Docker, Compose, graceful shutdown, CI, scaling                    |
| 18  | [Exercise: build a new module](18-exercise-build-a-module.md)        | Building a `products` module step by step                                    |
| —   | [Glossary](glossary.md)                                              | Terms and what they mean                                                     |

## How every chapter is organized

To make chapters easy to follow, each one uses the same structure:

1. **Goals**: what you will understand by the end.
2. **Core concepts**: the general explanation, often with an everyday analogy.
3. **In this boilerplate**: the real files and code, discussed line by line where useful.
4. **Step by step**: the order in which things happen, often with a diagram.
5. **Try it yourself**: `curl` commands or steps you can run right away.
6. **Common mistakes**: frequent pitfalls and how the boilerplate avoids them.
7. **Summary** and a link to the next chapter.

> Note: the `curl` examples use bash syntax. On Windows, run them in Git Bash (installed with Git), or use Swagger UI.
