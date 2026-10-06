# 06. Databases: MySQL and Drizzle

## Goals

By the end of this chapter you will understand:

- the building blocks of a relational database: tables, rows, columns, keys and indexes;
- every table in this boilerplate and why each column looks the way it does;
- what an ORM is, and how Drizzle turns TypeScript into SQL;
- how migrations change the database safely over time;
- what a connection pool is and why the app needs one;
- how the repositories query data: filtering, searching, counting, paginating;
- what "soft delete" means and how it affects every query;
- how the code stays correct when two requests touch the same row at the same time.

## Core concepts

### A relational database in one picture

Think of a database as a **workbook of spreadsheets**. Each sheet is a **table**, each line in a sheet is a **row** (one record, for example one user), and each heading is a **column** (one attribute, for example `email`).

```
users
+--------------------------------------+-------+----------+------+-------------------------+------------+
| id                                   | name  | email    | role | created_at              | deleted_at |
+--------------------------------------+-------+----------+------+-------------------------+------------+
| 10c9e604-ee00-4984-8dab-3084cfe62fc7 | Ricky | r@x.com  | user | 2026-10-06 04:52:34.195 | NULL       |
| 6f1d...                              | Admin | a@x.com  | admin| 2026-10-06 04:53:01.002 | NULL       |
+--------------------------------------+-------+----------+------+-------------------------+------------+
```

Unlike a spreadsheet, a database **enforces rules**. The rules you will meet in this project:

| Term                  | Meaning                                                                                              | Example here                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| **Primary key**       | The column that uniquely identifies a row. Never repeats, never empty.                               | `users.id`                                       |
| **Unique**            | No two rows may hold the same value in this column.                                                  | `users.email`, `refresh_tokens.token_hash`       |
| **Not null**          | The column must always have a value.                                                                 | `users.name`                                     |
| **Default**           | The value used when an insert does not provide one.                                                  | `users.role` defaults to `user`                  |
| **Index**             | A sorted lookup structure (like the index at the back of a book) that makes searching a column fast. | `refresh_tokens_user_id_idx`                     |
| **Foreign key**       | A column that must point at an existing row in another table.                                        | `refresh_tokens.user_id` → `users.id`            |
| **ON DELETE CASCADE** | When the referenced row is deleted, rows pointing at it are deleted too.                             | Deleting a user row removes their refresh tokens |

The language for talking to a relational database is **SQL** (Structured Query Language): `SELECT` reads rows, `INSERT` adds them, `UPDATE` changes them, `DELETE` removes them.

**MySQL** is the database server this boilerplate uses. It runs as its own process (in development, inside Docker: `docker compose up -d mysql`), and the app talks to it over the network.

### ORM vs raw SQL

You could write SQL strings by hand:

```ts
pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [email]);
```

This works, but nothing checks that the column `email` exists, that you spelled `users` correctly, or what type each returned value has. An **ORM** (Object-Relational Mapper) or **query builder** lets you write queries in your programming language instead:

```ts
db.select().from(users).where(eq(users.email, email)).limit(1);
```

**Drizzle** is a lightweight, TypeScript-first ORM. It still produces plain SQL (you can read it in logs), but:

- the table definitions live in TypeScript, so a typo is a compile error;
- results are typed: `user.createdAt` is a `Date`, `user.role` is `"user" | "admin"`;
- values are always sent as **parameters**, never pasted into the SQL string, which prevents **SQL injection** (an attack where user input such as `' OR 1=1 --` changes the meaning of a query).

### Migrations

The database's structure (its **schema**) changes as the app grows: new tables, new columns. A **migration** is a SQL file that moves the schema from one version to the next. Migrations are:

- **ordered**: `0000_...`, `0001_...`, applied one after another;
- **recorded**: the database keeps a table of which migrations already ran, so each runs exactly once;
- **committed to git**: every developer and every server ends up with the same schema.

Analogy: migrations are like the numbered renovation plans for a house. You never edit plan #3 after the builders finished it; if you change your mind, you write plan #4.

## In this boilerplate

### The schema: `src/db/schema.ts`

All tables are declared in one file. Two small helpers keep the definitions consistent:

```ts
// src/db/schema.ts
/** UUID primary key generated by the app, so inserts know the id up front. */
const id = () =>
  varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => randomUUID());

/** Millisecond-precision DATETIME read as a JS Date (stored in UTC). */
const timestamp = (name: string) => datetime(name, { mode: "date", fsp: 3 });
```

**Why UUIDs generated by the app?** A UUID (Universally Unique Identifier) is a 128-bit random value like `10c9e604-ee00-4984-8dab-3084cfe62fc7`. Compared with auto-increment numbers (`1, 2, 3...`):

- ids cannot be guessed or counted: an attacker cannot try `/users/1`, `/users/2`, ... to discover how many users exist;
- the app knows the id **before** the insert, which helps because MySQL cannot return the inserted row (see `$returningId` below);
- ids can be created anywhere (another service, an import script) without asking the database.

**Why `DATETIME(3)` and UTC?** `fsp: 3` means "fractional seconds precision 3", i.e. milliseconds. That keeps ordering by `created_at` meaningful even when two rows are created within the same second. All dates are stored in **UTC** (no time zone offset); the connection pool is configured with `timezone: "Z"` so a JavaScript `Date` goes in and comes out unchanged, whatever time zone the server runs in. Clients receive ISO strings like `2026-10-06T04:52:34.195Z` and convert to local time themselves.

The `created_at` / `updated_at` pair is shared:

```ts
const timestamps = {
  createdAt: timestamp("created_at")
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date()),
};
```

`$defaultFn` and `$onUpdateFn` run **in the app** (Drizzle fills the value when it builds the INSERT or UPDATE), so you never set these fields by hand.

Now table by table.

#### `users`

```ts
export const users = mysqlTable(
  "users",
  {
    id: id(),
    name: varchar("name", { length: 100 }).notNull(),
    email: varchar("email", { length: 255 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: mysqlEnum("role", USER_ROLES).notNull().default("user"),
    ...timestamps,
    deletedAt: timestamp("deleted_at"),
  },
  (table) => [index("users_created_at_idx").on(table.createdAt)],
);
```

- `email` is **unique**: the database itself refuses a second account with the same address.
- `password_hash` stores a hash, never the password (chapter 7).
- `role` is an **enum** column: MySQL only accepts the listed values (`USER_ROLES` = `["user", "admin"]`).
- `deleted_at` is `NULL` for live users and holds a date for deleted ones (soft delete, below).
- The index on `created_at` speeds up the default "newest first" listing.

Note the naming: TypeScript uses `camelCase` (`passwordHash`), the database uses `snake_case` (`password_hash`). Drizzle maps between them.

#### `refresh_tokens`

```ts
export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    id: id(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    familyId: varchar("family_id", { length: 36 }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamps.createdAt,
  },
  (table) => [
    index("refresh_tokens_user_id_idx").on(table.userId),
    index("refresh_tokens_family_id_idx").on(table.familyId),
  ],
);
```

- `user_id` is a **foreign key** with `ON DELETE CASCADE`: if a user row is ever removed for real, its tokens disappear with it.
- `token_hash` is 64 characters because a SHA-256 hash written in hex is exactly 64 characters (chapter 7).
- The two indexes exist because the code looks tokens up by user (`revokeAllForUser`) and by family (`revokeFamily`).

#### `audit_logs`

```ts
export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: id(),
    actorId: varchar("actor_id", { length: 36 }),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entity_type", { length: 64 }).notNull(),
    entityId: varchar("entity_id", { length: 36 }),
    metadata: json("metadata").$type<Record<string, unknown>>(),
    ip: varchar("ip", { length: 45 }),
    requestId: varchar("request_id", { length: 128 }),
    createdAt: timestamps.createdAt,
  },
  ...
);
```

This table deliberately has **no foreign keys**: the history must survive whatever happens to the rows it mentions. `metadata` is a `JSON` column for free-form details. `ip` is 45 characters, the longest possible text form of an IPv6 address. Chapter 14 covers the audit log in depth.

#### `files`

```ts
export const files = mysqlTable(
  "files",
  {
    id: id(),
    ownerId: varchar("owner_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    originalName: varchar("original_name", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 100 }).notNull(),
    size: bigint("size", { mode: "number", unsigned: true }).notNull(),
    storageKey: varchar("storage_key", { length: 64 }).notNull().unique(),
    createdAt: timestamps.createdAt,
  },
  (table) => [index("files_owner_id_idx").on(table.ownerId)],
);
```

This table holds only **metadata**; the bytes live in file storage under `storageKey` (chapter 13). `size` is `BIGINT UNSIGNED` (no negative sizes) read as a JavaScript `number`.

### Migrations: `drizzle/` and `src/db/migrate.ts`

The workflow has two commands:

```
edit src/db/schema.ts
        │
        ▼
npm run db:generate   ← drizzle-kit compares schema.ts with the last snapshot
        │                and writes drizzle/000N_<name>.sql (review it!)
        ▼
npm run db:migrate    ← applies every migration not yet recorded in the database
```

`db:generate` does not touch the database; it only writes files. The generated SQL for this project is in `drizzle/0000_init.sql`, for example:

```sql
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`name` varchar(100) NOT NULL,
	`email` varchar(255) NOT NULL,
	...
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
```

`db:migrate` runs `src/db/migrate.ts`:

```ts
// src/db/migrate.ts
const main = async () => {
  const db = createDatabase(env.DATABASE_URL);

  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    logger.info("Migrations applied");
  } finally {
    await db.$client.end();
  }
};
```

`migrate` reads the `drizzle/` folder and a bookkeeping table in the database (Drizzle names it `__drizzle_migrations`), then runs only the files that are missing. Running it twice is harmless.

Why a script instead of `drizzle-kit migrate`? `drizzle-kit` is a **dev dependency** (not installed in the production Docker image). The script uses the runtime driver, so the container can migrate with `node dist/db/migrate.js` (the `migrate` service in `docker-compose.yml` does exactly that).

### The connection pool: `src/db/index.ts`

Opening a connection to MySQL is slow (network handshake, authentication). Opening one per request would waste time; sharing one connection for everything would make requests wait in line. A **connection pool** keeps a few connections open and lends them out:

```
request A ──┐                 ┌── connection 1 ──┐
request B ──┼──► pool (≤10) ──┼── connection 2 ──┼──► MySQL
request C ──┘                 └── connection 3 ──┘
```

```ts
// src/db/index.ts
export const createDatabase = (url: string) => {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    // Store and read DATETIME values as UTC, whatever the server time zone.
    timezone: "Z",
  });

  return drizzle({ client: pool, schema, mode: "default" });
};
```

Analogy: the pool is a taxi rank with 10 taxis. Each request takes a taxi, rides to MySQL and back, and returns the taxi. When all 10 are out, the next request waits for one to return. On shutdown, `server.ts` calls `db.$client.end()` to send all taxis home (chapter 17).

`DATABASE_URL` has the form `mysql://user:password@host:3306/database`; `src/config/env.ts` refuses to start with anything that is not a `mysql://` URL.

### Repositories: how queries are written

Only repositories touch the database (chapter 4). Let us read `src/modules/users/user.repository.ts`.

#### Reading one row

```ts
async findById(id: string): Promise<User | null> {
  const [user] = await this.db
    .select()
    .from(users)
    .where(and(eq(users.id, id), notDeleted))
    .limit(1);

  return user ?? null;
}
```

Roughly the SQL: `SELECT * FROM users WHERE id = ? AND deleted_at IS NULL LIMIT 1`. A `select` always returns an **array**; destructuring `[user]` takes the first element, which is `undefined` when nothing matched, hence `?? null`.

#### Searching, filtering and sorting

```ts
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

async findAll(input: FindUsersInput): Promise<FindUsersResult> {
  const filters: SQL[] = [notDeleted];

  if (input.search) {
    const pattern = `%${escapeLike(input.search)}%`;
    filters.push(or(like(users.name, pattern), like(users.email, pattern))!);
  }
  if (input.role) filters.push(eq(users.role, input.role));

  const where = and(...filters);
  ...
}
```

- `LIKE '%zoe%'` matches any value containing `zoe`. In LIKE patterns `%` means "any characters" and `_` means "any one character".
- **`escapeLike`** puts a backslash before `%`, `_` and `\` in the user's text. Without it, a search for `%` would match every user, and a search for `50%` would not mean "the literal text 50%". This is not about SQL injection (the value is still a parameter); it is about the pattern meaning what the user typed.
- MySQL's default collation compares text case-insensitively, so `ZOE` finds `Zoe`.
- Filters are collected in an array and combined with `and(...)`. Optional filters are simply not added.

#### Counting and pagination

```ts
const [rows, total] = await Promise.all([
  this.db
    .select()
    .from(users)
    .where(where)
    // The id tiebreaker keeps pages stable when sort values are equal.
    .orderBy(direction(column), direction(users.id))
    .limit(input.limit)
    .offset(offsetOf(input)),
  this.db.$count(users, where),
]);
```

This is **offset pagination**: page 3 with 10 per page means "skip 20 rows, take 10". The helper lives in `src/shared/http/pagination.ts`:

```ts
export const offsetOf = ({ page, limit }: PaginationQuery) =>
  (page - 1) * limit;
```

Two queries run **in parallel** with `Promise.all`: the page of rows, and the total count (`$count` → `SELECT count(*) ...`) with the **same** `where`, so `meta.total` matches the filter. The service then builds `meta` with `paginate(...)`, including `totalPages = Math.ceil(total / limit)`.

**Why the `users.id` tiebreaker?** If two users have the same name and you sort by name, the database may return them in either order, and that order may differ between the query for page 1 and page 2. A user could then appear on both pages or on neither. Adding a second, unique sort key (`id`) makes the order **total**: every row has exactly one position.

#### Inserting: `$returningId` because MySQL has no `RETURNING`

PostgreSQL can answer an `INSERT` with the inserted row (`INSERT ... RETURNING *`). MySQL cannot. Drizzle's `$returningId()` gives back just the primary key (here, the UUID the app generated), and the repository reads the row back to get every default (`role`, `created_at`, ...):

```ts
async create(input: CreateUserInput): Promise<User> {
  const [inserted] = await this.db
    .insert(users)
    .values({
      name: input.name,
      email: normalizeEmail(input.email),
      passwordHash: input.passwordHash,
    })
    .$returningId();

  // MySQL has no RETURNING; read the row back for its defaults.
  const user = inserted && (await this.findById(inserted.id));
  ...
}
```

Notice `normalizeEmail` (lowercasing) happens in the repository, so every path that stores or looks up an email agrees on the format.

#### Updating and "how many rows changed?"

An `UPDATE` in MySQL returns a result header that includes `affectedRows`. A tiny helper in `src/db/errors.ts` reads it:

```ts
/** Rows changed by an UPDATE/DELETE, read from mysql2's result header. */
export const affectedRows = (result: [{ affectedRows: number }, unknown]) =>
  result[0].affectedRows;
```

It lets a single query both **do** the change and **tell** whether it happened, which matters for soft delete and for race conditions below.

### Soft delete

Deleting a user with `DELETE FROM users` would cascade away their refresh tokens and files, and break the audit history that mentions them. Instead, **soft delete** marks the row:

```ts
async softDelete(id: string): Promise<boolean> {
  const result = await this.db
    .update(users)
    .set({ deletedAt: new Date() })
    .where(and(eq(users.id, id), notDeleted));

  return affectedRows(result) > 0;
}
```

The cost of soft delete: **every query must remember to skip deleted rows**. The repository makes that hard to forget with one shared condition:

```ts
/** Deleted users are invisible to every query except the email check. */
const notDeleted = isNull(users.deletedAt);
```

`findById`, `findByEmail`, `findAll` and `update` all include it. So a deleted user cannot log in (`findByEmail` finds nothing), cannot refresh (`findById` finds nothing), and does not appear in lists.

The one **deliberate exception** is `isEmailTaken`:

```ts
async isEmailTaken(email: string, exceptUserId?: string): Promise<boolean> {
  const count = await this.db.$count(
    users,
    and(
      eq(users.email, normalizeEmail(email)),
      exceptUserId ? ne(users.id, exceptUserId) : undefined,
    ),
  );

  return count > 0;
}
```

There is no `notDeleted` here, because the `email` column is unique **across all rows**, deleted ones included. If the check ignored deleted users, registering a deleted user's email would pass the check and then fail on the database constraint. Instead the service answers a clear `409 EMAIL_ALREADY_EXISTS`. (`and(...)` ignores `undefined`, which is how the optional `exceptUserId` condition is added only when needed.)

### Race conditions

A **race condition** happens when the result depends on the timing of two concurrent operations. Classic example: two requests check "is this refresh token still active?" at the same moment, both see "yes", and both proceed to issue new tokens. One stolen token would then produce two valid sessions.

The fix is to make "check and change" a **single atomic statement**, so the database decides the winner:

```ts
// src/modules/authentication/refresh-token.repository.ts
async revokeIfActive(id: string): Promise<boolean> {
  // A single conditional UPDATE: of two concurrent calls, only one changes
  // the row.
  const result = await this.db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));

  return affectedRows(result) > 0;
}
```

```
request 1: UPDATE ... SET revoked_at = now WHERE id = X AND revoked_at IS NULL  → affectedRows = 1 ✅ winner
request 2: UPDATE ... SET revoked_at = now WHERE id = X AND revoked_at IS NULL  → affectedRows = 0 ❌ (already revoked)
```

MySQL locks the row while updating it, so the second statement sees the first one's change. Only one request gets `true`; chapter 7 explains what the loser does.

### The unique constraint as a safety net

`UserService.create` checks `isEmailTaken` before inserting. But two simultaneous registrations with the same email could both pass that check before either inserts. The **unique index** on `email` is the final guard: the second `INSERT` fails with MySQL error code `ER_DUP_ENTRY`.

```ts
// src/db/errors.ts
export const isUniqueViolation = (error: unknown): boolean => {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];

  return candidates.some(
    (candidate) =>
      (candidate as { code?: unknown } | null)?.code === "ER_DUP_ENTRY",
  );
};
```

Drizzle wraps driver errors, so the code is looked up on the error and on its `cause`. The error middleware turns it into `409 RESOURCE_ALREADY_EXISTS` instead of a 500. The rule of thumb: **check in code for a friendly error, constrain in the database for correctness.**

### Database errors are logged without parameters

Any other database failure surfaces as a `DrizzleQueryError`. Its `message` includes the query **parameters**, which may be personal data or password hashes. The error middleware logs only the SQL text and the driver's message:

```ts
// src/shared/middlewares/error.middleware.ts
if (error instanceof DrizzleQueryError) {
  // error.message also contains the query params (user data), so only the
  // SQL text and the driver error are logged.
  const cause = error.cause instanceof Error ? error.cause : undefined;

  logger.error("Database error", {
    requestId,
    query: error.query,
    error: cause?.message ?? String(error.cause),
    stack: cause?.stack,
  });

  sendError(
    res,
    StatusCodes.INTERNAL_SERVER_ERROR,
    ReasonPhrases.INTERNAL_SERVER_ERROR,
    "DATABASE_ERROR",
  );
  return;
}
```

The client sees only `500 DATABASE_ERROR`; nothing about tables or SQL leaks out.

## Step by step: `GET /api/v1/users?search=zoe&sortBy=name&sortOrder=asc&page=1&limit=10`

```
1. validate()      → query parsed: { page: 1, limit: 10, search: "zoe", sortBy: "name", sortOrder: "asc" }
2. UserController  → userService.findAll(req.query)
3. UserService     → userRepository.findAll(input)
4. CachedUserRepository.findAll → passes straight through (lists are not cached)
5. DrizzleUserRepository.findAll builds:
     filters = [deleted_at IS NULL, (name LIKE '%zoe%' OR email LIKE '%zoe%')]
     in parallel:
       SELECT * FROM users WHERE <filters> ORDER BY name ASC, id ASC LIMIT 10 OFFSET 0
       SELECT count(*) FROM users WHERE <filters>
6. UserService     → paginate(rows, total, input) → { data, meta: { page, limit, total, totalPages } }
7. Controller      → maps each row with toUserResponse (no passwordHash) and sends the response
```

## Try it yourself

Start the stack and apply migrations if you have not yet:

```bash
docker compose up -d mysql
npm run db:migrate
npm run dev
```

1. **Look at the tables.** Open a MySQL shell inside the container:

   ```bash
   docker compose exec mysql mysql -uapp -papp app
   ```

   ```sql
   SHOW TABLES;
   DESCRIBE users;
   SELECT * FROM __drizzle_migrations;
   ```

   Or browse visually with `npm run db:studio`.

2. **Register two users and see the rows:**

   ```bash
   curl -s -X POST http://localhost:3000/api/v1/authentication/register \
     -H 'Content-Type: application/json' \
     -d '{"name":"Zoe","email":"zoe@x.com","password":"correct horse battery"}'
   curl -s -X POST http://localhost:3000/api/v1/authentication/register \
     -H 'Content-Type: application/json' \
     -d '{"name":"Ann","email":"ann@x.com","password":"correct horse battery"}'
   ```

   ```sql
   SELECT id, email, role, created_at, deleted_at FROM users;
   SELECT user_id, token_hash, family_id, revoked_at FROM refresh_tokens;
   ```

   Notice `password_hash` starts with `$argon2id$` and `token_hash` is 64 hex characters.

3. **Search and paginate** (needs an admin token; make one with `npm run user:make-admin -- zoe@x.com`, then log in again as Zoe):

   ```bash
   TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"zoe@x.com","password":"correct horse battery"}' \
     | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

   curl -s "http://localhost:3000/api/v1/users?search=ann&sortBy=name&sortOrder=asc&limit=1" \
     -H "Authorization: Bearer $TOKEN"
   ```

   Expected shape:

   ```json
   {
     "statusCode": 200,
     "message": "Users retrieved successfully",
     "data": [
       {
         "id": "...",
         "name": "Ann",
         "email": "ann@x.com",
         "role": "user",
         "createdAt": "...",
         "updatedAt": "..."
       }
     ],
     "meta": { "page": 1, "limit": 1, "total": 1, "totalPages": 1 }
   }
   ```

   Try `search=%25` (an encoded `%`): the result is empty, because the wildcard is escaped.

4. **Soft delete.** Delete Ann (as admin) and look at the row:

   ```bash
   ANN_ID=... # from the register response
   curl -s -X DELETE "http://localhost:3000/api/v1/users/$ANN_ID" -H "Authorization: Bearer $TOKEN"
   ```

   ```sql
   SELECT email, deleted_at FROM users;
   ```

   The row is still there, with `deleted_at` set. Registering `ann@x.com` again answers `409 EMAIL_ALREADY_EXISTS`.

## Common mistakes

- **Editing a migration that already ran.** The database will not re-run it, so your change never applies on existing databases (and servers drift apart). Write a new migration instead.
- **Forgetting the soft-delete condition** in a new query. Deleted users would come back to life in that feature. Reuse a shared condition like `notDeleted`.
- **Sorting without a unique tiebreaker.** Rows with equal sort values jump between pages.
- **Check-then-act in two queries** ("read the token, then update it"). Under concurrency both requests pass the check. Put the condition in the `WHERE` of the write and look at `affectedRows`.
- **Relying only on application checks for uniqueness.** Two requests can pass the check together; the unique constraint is what really guarantees it.
- **Storing local times.** Mixing time zones makes ordering and expiry checks wrong. Store UTC, convert at the edges.
- **Building SQL strings from user input.** Always let the ORM pass values as parameters.
- **Logging full database errors.** They may contain parameters such as emails or hashes.

## Summary

- A relational database stores rows in tables and enforces rules: primary keys, unique columns, foreign keys, defaults.
- `src/db/schema.ts` defines four tables; ids are app-generated UUIDs and timestamps are millisecond `DATETIME(3)` in UTC.
- Drizzle turns typed TypeScript into parameterized SQL; migrations in `drizzle/` evolve the schema and are applied with `npm run db:migrate`.
- A pool of up to 10 connections is shared by all requests.
- Repositories filter with composable conditions, escape LIKE wildcards, count with the same filter, and paginate with a stable order.
- Soft delete keeps rows but hides them everywhere except the email-uniqueness check.
- Atomic conditional updates and unique constraints keep data correct under concurrency.

Next: [07. Authentication](07-authentication.md)
