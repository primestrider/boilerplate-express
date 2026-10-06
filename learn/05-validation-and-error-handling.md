# 05 · Validation and Error Handling

## Goals

By the end of this chapter you will:

- understand why **every** input must be validated on the server,
- be able to read and write Zod schemas (coercion, defaults, transforms, `refine`, unknown keys),
- know how the `validate` middleware checks and **replaces** `req.body`, `req.params` and `req.query`,
- know when to throw an `HttpError` and which factory to use,
- be able to predict what the error middleware answers for any error,
- understand why unexpected errors hide their details in production and how the request id connects a client's error to a log line.

## Core concepts

### Never trust input

Everything that arrives in a request is **controlled by the client**, and the client may be a buggy app, a curious user with `curl`, or an attacker. The frontend's form validation does not protect you: anyone can skip the frontend and send raw HTTP.

So the server checks every value at the **trust boundary** (the moment data enters your code):

- is it the right **type**? (`"10"` vs `10`, a string vs an object)
- is it in the right **range**? (`limit=1000000`, a 5 MB name)
- is it the right **format**? (an email, a UUID)
- are there **extra fields** that should not be there? (`"role": "admin"` in a registration)

Think of a nightclub bouncer: checks your ID at the door, once, so nobody inside has to wonder whether you are old enough.

### Validation libraries and Zod

You could write `if (typeof body.email !== "string" || !body.email.includes("@")) ...` by hand for every field, but it gets long, inconsistent and easy to forget. **Zod** lets you describe the expected shape once as a **schema**:

```ts
const schema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().toLowerCase(),
});

schema.parse({ name: " Ann ", email: "ANN@X.COM" });
// → { name: "Ann", email: "ann@x.com" }

schema.parse({ name: "A", email: "nope" });
// → throws ZodError with one issue per problem
```

A schema does two things at once:

1. **Validates**: rejects bad data with precise messages.
2. **Transforms**: trims, lowercases, converts strings to numbers, fills defaults. What comes out is clean and ready to use.

And TypeScript can **infer the type** from the schema, so the type and the runtime check can never disagree:

```ts
type RegisterDto = z.infer<typeof registerSchema>; // { name: string; email: string; password: string }
```

### Expected vs unexpected errors

Two very different kinds of errors happen in a backend:

| Kind           | Examples                                                      | What the client should see                    | Log it as an error? |
| -------------- | ------------------------------------------------------------- | --------------------------------------------- | ------------------- |
| **Expected**   | invalid input, wrong password, not found, email already taken | A clear message and a stable `errorCode`      | No (it's normal)    |
| **Unexpected** | a bug (`undefined is not a function`), the database is down   | A generic "Internal Server Error", no details | Yes, with the stack |

This project models expected errors with the `HttpError` class; anything that is not an `HttpError` (or one of a few known library errors) is treated as unexpected.

## In this boilerplate

### Schemas live in `*.schema.ts`

Registration:

```ts
// src/modules/authentication/authentication.schema.ts
const email = z.string().trim().email().toLowerCase();

/**
 * Password length follows OWASP: at least 8, and a generous upper bound that
 * still caps hashing work per request.
 */
const password = z.string().min(8).max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password,
});
```

Listing users, built on the shared pagination schema:

```ts
// src/modules/users/user.schema.ts
export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Matches name or email"),
  role: z.enum(USER_ROLES).optional(),
  sortBy: z.enum(USER_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
```

Updating a user, with a rule across fields:

```ts
// src/modules/users/user.schema.ts
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(255).toLowerCase().optional(),
  })
  .refine((body) => body.name !== undefined || body.email !== undefined, {
    message: "Provide at least one field to update",
  });
```

The Zod features used across the project:

| Feature                       | Example                                        | What it does                                                                           |
| ----------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------- |
| Type + limits                 | `z.string().min(8).max(128)`                   | Rejects wrong types and lengths                                                        |
| Format                        | `.email()`, `z.uuid()`                         | Rejects malformed values                                                               |
| Transform                     | `.trim()`, `.toLowerCase()`                    | Cleans the value; the handler receives the cleaned version                             |
| **Coercion**                  | `z.coerce.number()`                            | Turns `"2"` (query strings are always text) into `2`; `"abc"` fails                    |
| **Default**                   | `.default(10)`                                 | Fills a missing value                                                                  |
| Enum                          | `z.enum(USER_ROLES)`                           | Only listed values; reuses the same constant as the database column                    |
| Optional                      | `.optional()`                                  | The field may be missing                                                               |
| **`refine`**                  | "at least one field", "new ≠ current password" | Custom rules, including rules that compare fields                                      |
| **Unknown keys are stripped** | `z.object({...})`                              | `{"role":"admin"}` in a registration body is silently dropped, never reaching the code |

That last row is a security feature. Without it, a sloppy `db.insert(users).values(req.body)` would let anyone register as an admin by adding `"role": "admin"`. Because the parsed body only contains `name`, `email` and `password`, that attack cannot work.

**Input vs output types.** With defaults and coercion, what the client sends and what your code receives differ: the client may omit `page` or send `"2"`; your code always gets a number. The OpenAPI docs use the "input" shape for requests and the "output" shape for responses (`src/docs/openapi.ts`, function `jsonSchema(schema, io)`).

### The `validate` middleware

Routes declare which parts of the request to check:

```ts
// src/modules/users/user.routes.ts
router.patch(
  "/:id",
  validate({ params: userIdParamsSchema, body: updateUserSchema }),
  userController.update,
);
```

The middleware parses each part and **replaces** the raw value with the parsed one:

```ts
// src/shared/middlewares/validate.middleware.ts
(req, _res, next) => {
  try {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body) as typeof req.body;
    }

    if (schemas.params) {
      req.params = schemas.params.parse(req.params) as typeof req.params;
    }

    if (schemas.query) {
      // Express 5 exposes req.query as a getter, so the parsed value is
      // defined as an own property that shadows it for this request.
      Object.defineProperty(req, "query", {
        value: schemas.query.parse(req.query),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(
        HttpError.badRequest("Validation error", {
          errorCode: "VALIDATION_ERROR",
          details: formatZodError(error),
        }),
      );
      return;
    }

    next(error);
  }
};
```

Things to notice:

1. **Replacement** means the controller only ever sees cleaned data: trimmed, lowercased, numbers instead of strings, defaults filled in, unknown keys gone.
2. **`req.query` is special in Express 5**: it is a getter that re-parses the URL every time, so assigning to it does not stick. `Object.defineProperty` puts the parsed value on the request object itself, hiding the getter for this request.
3. **Errors are translated**: a `ZodError` becomes an `HttpError` 400 with `VALIDATION_ERROR` and readable `details`:

```ts
// src/shared/middlewares/validate.middleware.ts
export const formatZodError = (error: z.ZodError) =>
  error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
```

4. **Types follow the schemas.** `validate` is generic: the handler after it is typed from the schemas, so if a controller declares `RequestHandler<UserIdParamsDto, unknown, UpdateUserDto>` and the route validated something else, TypeScript complains.

### `HttpError`: expected errors

```ts
// src/shared/errors/http-error.ts
export class HttpError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string | undefined;
  public readonly details: unknown;
  ...
  static badRequest(message: string, options: FactoryOptions = {}) { ... }
  static unauthorized(...) { ... }
  static forbidden(...) { ... }
  static notFound(...) { ... }
  static conflict(...) { ... }
  static serviceUnavailable(...) { ... }
}
```

Services and middleware **throw** it; they never build an error response themselves:

```ts
// src/modules/users/user.service.ts
const userNotFound = () =>
  HttpError.notFound("User not found", { errorCode: "USER_NOT_FOUND" });
```

For a status without a factory, use the constructor:

```ts
// src/modules/files/file.service.ts
throw new HttpError(
  `Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
  {
    statusCode: StatusCodes.UNSUPPORTED_MEDIA_TYPE,
    errorCode: "UNSUPPORTED_FILE_TYPE",
  },
);
```

Rule of thumb: **don't `try/catch` just to forward an error**; Express 5 forwards thrown errors and rejected promises on its own (chapter 3). Catch only to **translate** an error into a better one (as `validate` does with `ZodError`, or `TokenService.verifyAccessToken` with JWT errors), or to deliberately **degrade** (the user cache ignoring a Redis outage, chapter 10).

### The error middleware: one place that answers errors

`src/shared/middlewares/error.middleware.ts` is registered last in `app.ts`. It checks the error in this order:

| #   | Error                                        | Response                                                                                              | Logged?             |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------- |
| 1   | Response already started (`res.headersSent`) | Too late for JSON: passed to Express, which closes the connection                                     | Yes                 |
| 2   | `ZodError` thrown outside `validate`         | 400 `VALIDATION_ERROR` with `details`                                                                 | No                  |
| 3   | `HttpError`                                  | Its own status, message, `errorCode`, `details`                                                       | No                  |
| 4   | `MulterError` (uploads)                      | 413 `FILE_TOO_LARGE`, otherwise 400 `INVALID_UPLOAD`                                                  | No                  |
| 5   | 4xx from Express/body-parser                 | That status, e.g. 400 malformed JSON (`BAD_REQUEST`), 413 body too large (`REQUEST_ENTITY_TOO_LARGE`) | No                  |
| 6   | Duplicate key in MySQL (`ER_DUP_ENTRY`)      | 409 `RESOURCE_ALREADY_EXISTS`                                                                         | No                  |
| 7   | `DrizzleQueryError` (other DB errors)        | 500 `DATABASE_ERROR`                                                                                  | Yes, without params |
| 8   | Anything else                                | 500 `INTERNAL_SERVER_ERROR`; the stack is in `details` **only outside production**                    | Yes, with stack     |

A few design choices worth understanding:

- **4xx errors are not logged as errors.** A user typing a wrong password is not a server problem; it would drown real problems in noise. They still appear in the request log line with their status code.
- **Duplicate key as a safety net (row 6).** The service checks "is this email taken?" before inserting, but two registrations can race: both check, both see "free", both insert. The database's unique index stops the second one; the middleware turns that into a clean 409 instead of a 500.
- **Database errors are logged without query parameters (row 7).** The parameters are user data (emails, password hashes); logs are read by many people and kept for a long time.

```ts
// src/shared/middlewares/error.middleware.ts
logger.error("Database error", {
  requestId,
  query: error.query,
  error: cause?.message ?? String(error.cause),
  stack: cause?.stack,
});
```

### Why 500s hide details in production

The last branch:

```ts
// src/shared/middlewares/error.middleware.ts
sendError(
  res,
  StatusCodes.INTERNAL_SERVER_ERROR,
  ReasonPhrases.INTERNAL_SERVER_ERROR,
  "INTERNAL_SERVER_ERROR",
  // The stack (its first line is the original message) helps debugging
  // but must never reach clients in production.
  exposeStack ? { details: error.stack } : undefined,
);
```

`exposeStack` is `config.NODE_ENV !== "production"` (set in `app.ts`). A stack trace reveals file paths, library versions and sometimes data, which is free reconnaissance for an attacker. In development it is very handy, so you get it there.

This is also why `NODE_ENV` is **required** in `src/config/env.ts`: if it defaulted to `development`, a server that forgot to set it would leak stack traces in production.

### The request id ties it together

The client gets a generic 500, but the response carries `X-Request-Id`, and the error log line has the same `requestId`:

```
Response header:  X-Request-Id: 4b1d0c9e-2f7a-4c55-9d1e-...
Log line:         {"level":"error","message":"Unhandled error","requestId":"4b1d0c9e-...","error":"...","stack":"..."}
```

When a user reports "I got an error", ask for that id and you find the exact stack trace in seconds (chapter 15).

## Step by step: one bad request

`POST /api/v1/authentication/register` with `{"name":"R","email":"nope","password":"short","role":"admin"}`:

```
express.json()          → req.body = { name:"R", email:"nope", password:"short", role:"admin" }
credentials limiter     → OK
validate({ body })      → registerSchema.parse(...) throws ZodError with 3 issues
                          ("role" is ignored: unknown keys are stripped, not errors)
                        → next(HttpError 400 VALIDATION_ERROR, details=[...])
controller              ✗ skipped
error middleware        → instanceof HttpError → sendError(400, "Validation error", "VALIDATION_ERROR", details)
request logger          → logs statusCode 400 (info level, not an error)
```

## Try it yourself

```bash
API=http://localhost:3000/api/v1

# 1. Several problems at once: every issue is reported, "role" is just dropped
curl -s -X POST $API/authentication/register -H 'Content-Type: application/json' \
  -d '{"name":"R","email":"nope","password":"short","role":"admin"}'
# {"statusCode":400,"message":"Validation error","errorCode":"VALIDATION_ERROR","details":[
#   {"path":"name","message":"Too small: expected string to have >=2 characters"},
#   {"path":"email","message":"Invalid email address"},
#   {"path":"password","message":"Too small: expected string to have >=8 characters"}]}

# 2. Transforms: spaces trimmed, email lowercased, role ignored
curl -s -X POST $API/authentication/register -H 'Content-Type: application/json' \
  -d '{"name":"  Zed  ","email":"ZED@X.COM","password":"correct horse battery","role":"admin"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.user'
# { id: '...', name: 'Zed', email: 'zed@x.com', role: 'user', ... }

TOKEN=$(curl -s -X POST $API/authentication/login -H 'Content-Type: application/json' \
  -d '{"email":"zed@x.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
ME=$(curl -s -H "Authorization: Bearer $TOKEN" $API/authentication/profile \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.id')

# 3. A refine rule: the empty update is rejected
curl -s -X PATCH $API/users/$ME -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{}'
# {"statusCode":400,"message":"Validation error","errorCode":"VALIDATION_ERROR","details":[{"path":"","message":"Provide at least one field to update"}]}

# 4. Params validation
curl -s -H "Authorization: Bearer $TOKEN" $API/users/not-a-uuid
# {"statusCode":400,"message":"Validation error","errorCode":"VALIDATION_ERROR","details":[{"path":"id","message":"Invalid UUID"}]}

# 5. Body too large (over 100kb) → 413 from express.json()
node -e 'console.log(JSON.stringify({email:"a@b.com",password:"a".repeat(200000)}))' |
  curl -s -X POST $API/authentication/login -H 'Content-Type: application/json' --data @-
# {"statusCode":413,"message":"request entity too large","errorCode":"REQUEST_ENTITY_TOO_LARGE"}
```

Then try it in plain code. Create a scratch file `scratch.ts` in the project root (delete it afterwards):

```ts
import { listUsersQuerySchema } from "./src/modules/users/user.schema";

console.log(listUsersQuerySchema.parse({}));
// { page: 1, limit: 10, sortBy: 'createdAt', sortOrder: 'desc' }
console.log(listUsersQuerySchema.parse({ page: "3", role: "admin" }));
// { page: 3, limit: 10, role: 'admin', sortBy: 'createdAt', sortOrder: 'desc' }
console.log(listUsersQuerySchema.safeParse({ limit: "500" }).success);
// false
```

Run it with `npx tsx scratch.ts` (it only imports schemas, so no env vars are needed).

## Common mistakes

- **Validating only on the frontend.** Anyone can call the API directly.
- **Using `req.body` before validation**, or validating but keeping the raw value. Here the parsed value replaces the raw one, so there is nothing else to use.
- **Passing request bodies straight into database inserts.** Mass assignment lets clients set fields they should never control (`role`, `id`, `deletedAt`). Strip unknown keys and map fields explicitly.
- **Branching on error messages** instead of `errorCode`.
- **Building error responses in services** with `res.status(...)`. Throw, and let one middleware decide the format.
- **Logging every 4xx as an error**, or logging full request data (passwords, tokens) when something fails.
- **Sending stack traces to clients in production.**

## Summary

- Validate every input at the trust boundary; never rely on the client.
- Zod schemas both validate and transform, and give you the TypeScript type for free; unknown keys are stripped.
- `validate({ body, params, query })` parses each part, replaces it with the clean value, and turns `ZodError` into a 400 `VALIDATION_ERROR`.
- Expected failures are `HttpError`s thrown from services; one error middleware converts every error into the standard response.
- Unexpected errors become a generic 500 (stack only outside production), are logged with the request id, and can be traced from the client's `X-Request-Id`.

Next: [06 · Databases: MySQL and Drizzle](06-database-mysql-drizzle.md)
