# 14. Audit Log and Request Context

## Goals

By the end of this chapter you will understand:

- What an **audit log** is and how it differs from application logs.
- How the `audit_logs` table is designed, and why it has no foreign keys.
- How services record actions with `AuditService.record`.
- What **request context** is, and how Node's `AsyncLocalStorage` provides it.
- How to read the audit log through `GET /api/v1/audit-logs`.

## Core concepts

### Audit log vs application log

Both are "logs", but they answer different questions for different readers.

|          | Application log (chapter 15)                        | Audit log (this chapter)                                  |
| -------- | --------------------------------------------------- | --------------------------------------------------------- |
| Question | "What is the system doing? Why did it fail?"        | "**Who did what, to what, when, from where?**"            |
| Reader   | Developers and operators                            | Security team, admins, auditors, support                  |
| Where    | stdout → log platform, often kept for days or weeks | A database table, kept long, queryable                    |
| Content  | Everything technical: requests, errors, timings     | Only **security-relevant business actions**               |
| Shape    | Free-form messages                                  | Fixed fields: actor, action, entity, time, IP, request id |

A bank's CCTV recording (application log) shows everything that happened in the lobby. The **signed register** at the vault door (audit log) lists exactly who opened which box and when. When something goes wrong ("who made this user an admin?"), you want the register.

### Append-only

Audit entries are **only ever added**, never updated or deleted by the application. An audit log you can edit is not evidence.

### Request context

Many pieces of information belong to "the current request": its request id, the client's IP, the signed-in user. Code deep inside a service sometimes needs them (the audit log needs all three). Two ways to get them there:

1. **Pass them as parameters** through every function: controller → service → audit service. Every signature grows, and code that has nothing to do with HTTP (a service) starts depending on HTTP details.
2. **Store them in a request context** that any code can read while handling that request.

The difficulty: Node handles thousands of requests concurrently in **one thread**, interleaving them at every `await`. A plain global variable `currentUser` would be overwritten by the next request while the first one is waiting for the database.

### AsyncLocalStorage

Node's built-in `AsyncLocalStorage` (module `node:async_hooks`) solves this. It is like giving every request its own **backpack**: when the request starts, you hand it a backpack with its id, IP and user inside. Wherever that request's code goes, through `await`s, callbacks and timers, it carries **its own** backpack. Another request running "at the same time" carries a different one.

In languages with threads, the same idea is called **thread-local storage**; `AsyncLocalStorage` is the equivalent for async code.

```
request A ── storage.run({requestId: A, ip: 1.1.1.1}) ── await db ── getStore() → A
request B ── storage.run({requestId: B, ip: 2.2.2.2}) ── await db ── getStore() → B
                    (interleaved on one thread, never mixed up)
```

## In this boilerplate

### The request context: `src/shared/context/request-context.ts`

```ts
export type RequestContext = {
  requestId: string;
  ip: string | undefined;
  /** Set by `authenticate` once the caller is known. */
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` (the rest of the request) with the given context. */
export const runWithRequestContext = (
  context: RequestContext,
  fn: () => void,
) => storage.run(context, fn);

/** The current request's context, or undefined outside a request (CLI, jobs). */
export const getRequestContext = (): RequestContext | undefined =>
  storage.getStore();
```

Only two functions are exported: one to **open** a context, one to **read** it. Outside a request (the CLI, a background job) `getRequestContext()` returns `undefined`, and callers must handle that.

### Opening the context: the request-id middleware

`src/shared/middlewares/request-id.middleware.ts` is the **first** middleware in `app.ts`, so everything after it runs inside the context:

```ts
export const requestIdMiddleware: RequestHandler = (req, res, next) => {
  const incoming = req.get(REQUEST_ID_HEADER);
  const requestId =
    incoming && VALID_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  res.locals.requestId = requestId;
  res.set(REQUEST_ID_HEADER, requestId);

  runWithRequestContext({ requestId, ip: req.ip }, next);
};
```

The key line is the last one: instead of calling `next()` directly, it calls `next` **inside** `runWithRequestContext`. Everything Express does next for this request (other middleware, routes, controllers, services) runs inside that context.

### Adding the user: `authenticate`

When a protected route identifies the caller, `src/modules/authentication/authenticate.middleware.ts` adds the user id to the same context object:

```ts
const auth = tokenService.verifyAccessToken(token);
res.locals.auth = auth;
res.removeHeader("WWW-Authenticate");

const context = getRequestContext();
if (context) context.userId = auth.userId;
```

The context object is shared for the whole request, so setting `userId` here makes it visible to everything that runs afterwards.

### The `audit_logs` table

From `src/db/schema.ts`:

```ts
/**
 * Append-only record of security-relevant actions. `actorId` is null for
 * actions without a signed-in user (CLI, system). No foreign keys, so the
 * history survives whatever happens to the rows it mentions.
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: id(),
  actorId: varchar("actor_id", { length: 36 }),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entity_type", { length: 64 }).notNull(),
  entityId: varchar("entity_id", { length: 36 }),
  metadata: json("metadata").$type<Record<string, unknown>>(),
  ip: varchar("ip", { length: 45 }),
  requestId: varchar("request_id", { length: 128 }),
  createdAt: timestamps.createdAt,
}, ...indexes on actor_id, (entity_type, entity_id), created_at);
```

| Column                    | Meaning                                                                 |
| ------------------------- | ----------------------------------------------------------------------- |
| `actorId`                 | **Who** did it (a user id), or `null` (system, CLI, anonymous)          |
| `action`                  | **What** happened, e.g. `user.role_changed`                             |
| `entityType` / `entityId` | **To what**, e.g. `user` / `0b6c...`                                    |
| `metadata`                | Extra **details** as JSON, e.g. `{ "from": "user", "to": "admin" }`     |
| `ip`, `requestId`         | **From where**, and a link to the application log lines of that request |
| `createdAt`               | **When**                                                                |

**Why no foreign keys?** Other tables use foreign keys with `ON DELETE CASCADE` (deleting a user deletes their refresh tokens). For an audit log that would be a disaster: deleting a file row would delete the evidence that it was uploaded. Without foreign keys, entries keep pointing to ids that may no longer exist, which is exactly what history should do. (`ip` is 45 characters long, enough for an IPv6 address.)

The indexes match the common questions: "what did this actor do?", "what happened to this entity?", "what happened recently?".

### The list of actions

`src/modules/audit/audit.entity.ts`:

```ts
export const AUDIT_ACTIONS = [
  "auth.registered",
  "auth.login",
  "auth.login_failed",
  "auth.password_changed",
  "auth.refresh_token_reused",
  "user.updated",
  "user.role_changed",
  "user.deleted",
  "file.uploaded",
  "file.deleted",
] as const;
```

A fixed list (instead of free text) means TypeScript rejects typos when recording, and the list endpoint can validate its `action` filter against it.

### Recording an action: `AuditService.record`

`src/modules/audit/audit.service.ts`:

```ts
async record(entry: AuditEntry): Promise<void> {
  const context = getRequestContext();

  await this.repository.create({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    actorId:
      entry.actorId === undefined ? (context?.userId ?? null) : entry.actorId,
    metadata: entry.metadata ?? null,
    ip: context?.ip ?? null,
    requestId: context?.requestId ?? null,
  });
}
```

The caller only describes the action; actor, IP and request id are filled in **from the context**. The actor rule deserves attention:

- `actorId` **not given** (`undefined`) → use the signed-in user from the context.
- `actorId` **given**, even `null` → use exactly that.

Why would a caller override it? On `login` there is no signed-in user yet (no `authenticate` ran), so the service passes the user who just logged in. On `login_failed` and `refresh_token_reused` it passes `null` on purpose: the person acting is unknown, maybe an attacker.

So a service call looks like this (`src/modules/users/user.service.ts`):

```ts
await this.auditService.record({
  action: "user.role_changed",
  entityType: "user",
  entityId: id,
  metadata: { from: previousRole, to: role },
});
```

No HTTP details in sight, yet the stored entry contains the admin who made the change, their IP and the request id.

Services record **right after** the action succeeded, so the log never claims something happened that did not.

### What is recorded where

| Action                      | Recorded in                                   | Actor                      | Metadata                      |
| --------------------------- | --------------------------------------------- | -------------------------- | ----------------------------- |
| `auth.registered`           | `AuthenticationService.register`              | the new user               | —                             |
| `auth.login`                | `AuthenticationService.login`                 | the user logging in        | —                             |
| `auth.login_failed`         | `AuthenticationService.login`                 | `null`                     | — (entity = user, if known)   |
| `auth.refresh_token_reused` | `AuthenticationService.refresh`               | `null`                     | `familyId`                    |
| `auth.password_changed`     | `AuthenticationService.changePassword`        | caller (context)           | —                             |
| `user.updated`              | `UserService.update`                          | caller (context)           | `fields` changed              |
| `user.role_changed`         | `UserService.changeRole`, `cli/make-admin.ts` | caller, or `null` from CLI | `from`, `to` (+ `via: "cli"`) |
| `user.deleted`              | `UserService.delete`                          | caller (context)           | —                             |
| `file.uploaded`             | `FileService.upload`                          | caller (context)           | `mimeType`, `size`            |
| `file.deleted`              | `FileService.delete`                          | caller (context)           | —                             |

Notice `user.updated` stores **which fields** changed, not their values, and failed logins do **not** store the email that was typed.

### What never goes into metadata

The type definition says it directly: `/** Never put secrets (passwords, tokens) here. */`. Audit logs are kept long and read by many people. Never store:

- Passwords (even wrong ones: a wrong password is often a real password with a typo, or the password of another site).
- Tokens, API keys, session ids.
- More personal data than needed (prefer ids over names and emails).

### Reading the log: `GET /api/v1/audit-logs`

Admin only (`src/modules/audit/audit.routes.ts` uses `router.use(authenticate, requireRole("admin"))`). Query parameters, from `src/modules/audit/audit.schema.ts`:

| Parameter       | Meaning                              |
| --------------- | ------------------------------------ |
| `page`, `limit` | Pagination (limit 1–100, default 10) |
| `actorId`       | Entries by one actor (UUID)          |
| `action`        | One of `AUDIT_ACTIONS`               |
| `entityType`    | e.g. `user`, `file`                  |
| `entityId`      | Entries about one entity             |

Results are newest first.

## Step by step: an admin changes a role

1. Request arrives → `requestIdMiddleware` opens the context `{ requestId, ip }`.
2. `authenticate` verifies the admin's token and sets `context.userId = adminId`.
3. `requireRole("admin")` passes; `validate` checks the body.
4. `UserController.changeRole` → `UserService.changeRole(adminId, targetId, "admin")`.
5. The service updates the role, then calls `auditService.record({ action: "user.role_changed", ... })`.
6. `record` reads the context and stores `actorId = adminId`, `ip`, `requestId`.
7. Later, the request id in the audit entry leads straight to the application log lines of that request (chapter 15).

## Try it yourself

You need an admin token. Register a user and promote them with the CLI:

```bash
curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Audit Admin","email":"audit-admin@example.com","password":"correct horse battery"}' > /dev/null
npm run user:make-admin -- audit-admin@example.com

# Log in again so the token carries the admin role
ADMIN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"audit-admin@example.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# Make a failed login to have something interesting
curl -s -X POST http://localhost:3000/api/v1/authentication/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"audit-admin@example.com","password":"wrong password"}' > /dev/null

# Read the log
curl -s "http://localhost:3000/api/v1/audit-logs?limit=5" -H "Authorization: Bearer $ADMIN"
```

You should see entries like these (newest first, shortened; on a fresh database, ids and the IP format will differ on your machine):

```json
{
  "statusCode": 200,
  "message": "Audit logs retrieved successfully",
  "data": [
    { "action": "auth.login_failed", "actorId": null, "entityType": "user", "entityId": "…", "ip": "::1", "requestId": "…" },
    { "action": "auth.login", "actorId": "…", "entityType": "user", … },
    { "action": "user.role_changed", "actorId": null, "metadata": { "from": "user", "to": "admin", "via": "cli" }, "ip": null, "requestId": null, … },
    { "action": "auth.registered", … }
  ],
  "meta": { "page": 1, "limit": 5, "total": 4, "totalPages": 1 }
}
```

The CLI entry has no IP or request id: it did not come through HTTP, so there was no request context.

Filter by action, and trace a request with your own request id:

```bash
curl -s "http://localhost:3000/api/v1/audit-logs?action=auth.login_failed" \
  -H "Authorization: Bearer $ADMIN"

curl -s -X POST http://localhost:3000/api/v1/authentication/login \
  -H 'Content-Type: application/json' -H 'X-Request-Id: my-trace-123' \
  -d '{"email":"audit-admin@example.com","password":"nope"}' > /dev/null
curl -s "http://localhost:3000/api/v1/audit-logs?limit=1" -H "Authorization: Bearer $ADMIN"
# ... "requestId":"my-trace-123" ...
```

An unknown action is rejected by validation:

```bash
curl -s "http://localhost:3000/api/v1/audit-logs?action=nope" -H "Authorization: Bearer $ADMIN"
# {"statusCode":400,"message":"Validation error","errorCode":"VALIDATION_ERROR","details":[...]}
```

## Common mistakes

- **Using the application log as an audit trail.** It is noisy, short-lived and hard to query by actor or entity.
- **Foreign keys with cascade on audit tables.** Deleting data would erase its history.
- **Recording before the action succeeded.** The log would claim things that did not happen.
- **Storing secrets or excess personal data in metadata.**
- **A global variable for "the current user".** Concurrent requests overwrite each other; use `AsyncLocalStorage`.
- **Assuming a context always exists.** CLI scripts and background jobs run outside requests; handle `undefined`.

## Summary

- An audit log answers "who did what, to what, when, from where" and is append-only.
- `audit_logs` has fixed columns, useful indexes, and deliberately no foreign keys.
- Services call `auditService.record({ action, entityType, entityId, metadata })`; actor, IP and request id come from the request context.
- `AsyncLocalStorage` gives each request its own context across `await`s; the request-id middleware opens it and `authenticate` adds the user.
- Admins read the log at `GET /api/v1/audit-logs` with filters.

Next: [15. Observability](15-observability.md).
