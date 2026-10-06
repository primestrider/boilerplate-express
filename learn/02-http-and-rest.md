# 02 · HTTP and REST APIs

## Goals

By the end of this chapter you will:

- be able to read any HTTP request and response line by line,
- know what each HTTP method means, and which ones are "safe" or "idempotent",
- know every status code this API returns and when,
- recognize the headers this API uses and why,
- understand how the endpoints are designed (resources, versioning, pagination),
- understand the response envelope (`statusCode`, `message`, `data`, `meta`, `errorCode`, `details`).

## Core concepts

### HTTP in one picture

HTTP (HyperText Transfer Protocol) is a **text conversation** between a client and a server. The client sends a **request**; the server sends back exactly one **response**.

Think of it as sending a letter with a form attached:

- the **envelope** says where it goes and what kind of letter it is (method + path),
- the **stamps and notes on the envelope** are extra information (headers),
- the **letter inside** is optional content (body).

A real request to this API:

```http
POST /api/v1/authentication/login HTTP/1.1      ← method, path, version
Host: localhost:3000                            ← headers (key: value)
Content-Type: application/json
Content-Length: 58
                                                ← empty line ends the headers
{"email":"r@x.com","password":"correct horse battery"}   ← body
```

And its response:

```http
HTTP/1.1 200 OK                                 ← version, status code, reason
Content-Type: application/json; charset=utf-8
X-Request-Id: 4b1d0c9e-...
RateLimit-Policy: 100;w=60

{"statusCode":200,"message":"Logged in successfully","data":{"accessToken":"eyJ...", ...}}
```

### Methods

The **method** says what you want to do with the thing at the path.

| Method   | Meaning                              | Safe? | Idempotent? | Used here for                           |
| -------- | ------------------------------------ | ----- | ----------- | --------------------------------------- |
| `GET`    | Read something                       | Yes   | Yes         | Profiles, lists, downloads, health      |
| `POST`   | Create something / trigger an action | No    | No          | Register, login, refresh, upload a file |
| `PATCH`  | Change part of something             | No    | Usually\*   | Update a user's name/email, change role |
| `DELETE` | Remove something                     | No    | Yes         | Delete a user, delete a file            |
| `PUT`    | Replace something entirely           | No    | Yes         | (not used in this API)                  |

- **Safe** means "does not change anything on the server". You can call a safe request as often as you like.
- **Idempotent** means "doing it twice has the same effect as doing it once". Deleting file `X` twice leaves the same result: `X` is gone (the second call answers 404, but the state is the same).
  \*A `PATCH` that sets `name` to `"Ann"` is idempotent; a `PATCH` that "adds 1 to a counter" would not be.

`POST` is neither, which is a problem when the network fails: did my upload happen or not? If the client retries, it might upload twice. Chapter 11 shows how the `Idempotency-Key` header fixes this.

### Status codes

The **status code** is a three-digit number that summarizes the outcome. The first digit is the category:

- `2xx` success, `3xx` "look elsewhere / nothing changed", `4xx` **the client** did something wrong, `5xx` **the server** failed.

The distinction between 4xx and 5xx matters: a 4xx tells the client "don't retry the same request, fix it", a 5xx says "this might work later".

## In this boilerplate

### Status codes this API returns

Every error carries a stable `errorCode` string (machine-readable, never changes) next to the human `message` (may change). Clients should branch on `errorCode`, not on `message`.

| Code  | When                                                                                  | `errorCode` examples                                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200` | Successful read, update, login, logout, delete                                        | —                                                                                                                                                     |
| `201` | Something was created (register, file upload)                                         | —                                                                                                                                                     |
| `304` | `GET` with `If-None-Match` and the response has not changed (no body)                 | —                                                                                                                                                     |
| `400` | Bad input: validation, malformed JSON, wrong current password, own role, missing file | `VALIDATION_ERROR`, `BAD_REQUEST`, `INVALID_CURRENT_PASSWORD`, `CANNOT_CHANGE_OWN_ROLE`, `FILE_REQUIRED`, `INVALID_UPLOAD`, `INVALID_IDEMPOTENCY_KEY` |
| `401` | Not authenticated: no token, bad token, expired token, wrong credentials              | `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`                                                      |
| `403` | Authenticated but not allowed                                                         | `FORBIDDEN`                                                                                                                                           |
| `404` | Route or resource does not exist (or is hidden from you)                              | `ROUTE_NOT_FOUND`, `USER_NOT_FOUND`, `FILE_NOT_FOUND`                                                                                                 |
| `409` | Conflict with the current state                                                       | `EMAIL_ALREADY_EXISTS`, `RESOURCE_ALREADY_EXISTS`, `IDEMPOTENCY_REQUEST_IN_PROGRESS`                                                                  |
| `413` | Body or file too large                                                                | `REQUEST_ENTITY_TOO_LARGE`, `FILE_TOO_LARGE`                                                                                                          |
| `415` | Uploaded file type not allowed                                                        | `UNSUPPORTED_FILE_TYPE`                                                                                                                               |
| `422` | `Idempotency-Key` reused for a different request                                      | `IDEMPOTENCY_KEY_REUSED`                                                                                                                              |
| `429` | Rate limit exceeded                                                                   | `TOO_MANY_REQUESTS`                                                                                                                                   |
| `500` | Unexpected server error                                                               | `INTERNAL_SERVER_ERROR`, `DATABASE_ERROR`                                                                                                             |
| `503` | A dependency is down (readiness), or the idempotency store is unavailable             | `DEPENDENCY_UNAVAILABLE`, `IDEMPOTENCY_UNAVAILABLE`                                                                                                   |

### Headers this API uses

| Header                                 | Direction | Purpose                                                                                           |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `Content-Type: application/json`       | both      | "The body is JSON". `express.json()` only parses bodies with this type                            |
| `Authorization: Bearer <token>`        | request   | Proves who you are (chapter 7). Missing/invalid → 401 with `WWW-Authenticate: Bearer`             |
| `X-Request-Id`                         | both      | A unique id per request, echoed in the response and written in every log line (chapter 15)        |
| `Idempotency-Key`                      | request   | Makes a `POST /v1/files` retry safe (chapter 11). Replays answer with `Idempotent-Replayed: true` |
| `RateLimit-Policy`, `RateLimit`        | response  | How many requests you may make per window and how many remain (chapter 9)                         |
| `ETag` / `If-None-Match`               | both      | A fingerprint of a response; send it back and an unchanged `GET` answers `304` with no body       |
| `Accept-Encoding` / `Content-Encoding` | both      | The client says "I understand gzip"; the server compresses responses over 1 KB                    |
| `Content-Disposition: attachment`      | response  | On file downloads: "save this, don't display it" (chapter 13)                                     |

Security headers such as `X-Content-Type-Options: nosniff` are added by `helmet` (chapter 9).

### Designing the endpoints (REST)

**REST** is a style of designing APIs around **resources** (nouns) instead of actions (verbs). The URL names the thing, the method says what to do with it:

```
GET    /api/v1/users              list users            (admin)
GET    /api/v1/users/:id          read one user
PATCH  /api/v1/users/:id          change one user
PATCH  /api/v1/users/:id/role     change a sub-resource: the user's role (admin)
DELETE /api/v1/users/:id          delete one user

POST   /api/v1/files              create (upload) a file
GET    /api/v1/files              list my files
GET    /api/v1/files/:id          read a file's metadata
GET    /api/v1/files/:id/content  read the file's bytes
DELETE /api/v1/files/:id          delete a file

GET    /api/v1/audit-logs         list audit entries     (admin)
```

Notice: no `/getUser` or `/deleteFile`. The pattern is predictable, so once you know one resource you can guess the others.

Authentication is the classic exception: actions like "log in" or "refresh my token" are not natural resources, so they are `POST` endpoints under `/api/v1/authentication/...` (`register`, `login`, `refresh`, `logout`, `change-password`) plus `GET .../profile`.

Why is the role a separate endpoint (`/users/:id/role`) instead of a field in `PATCH /users/:id`? Because **who** may do it is different: any user may rename themselves, only admins may change roles. Separate endpoints keep the authorization rule simple and visible in the route definition.

### Versioning: `/api/v1`

```ts
// src/routes.ts
/** Current API version; a breaking change gets /v2 next to it. */
export const API_VERSION_PREFIX = "/v1";
...
const router = Router();
router.use("/health", health.router);
router.use(API_VERSION_PREFIX, v1);
```

Once mobile apps are installed on phones, you cannot force everyone to update. If you ever need a **breaking change** (renaming a field, changing a response shape), you add `/api/v2` next to `/api/v1` and keep v1 running until old clients are gone.

Health checks (`/api/health/...`) and docs (`/api/docs`) are **not** versioned: load balancers and monitoring tools call them, and their URLs should not change when the business API does.

### The response envelope

Every JSON response has the same outer shape, built by three helpers in `src/shared/http/response.ts`:

```ts
// src/shared/http/response.ts
export type ApiResponse<T = unknown, M = unknown> = {
  statusCode: number;
  message?: ResponseMessage;
  data?: T;
  meta?: M;
  errorCode?: string;
  details?: unknown;
};
```

| Field        | Present on      | Meaning                                                           |
| ------------ | --------------- | ----------------------------------------------------------------- |
| `statusCode` | every response  | Always equal to the HTTP status code                              |
| `message`    | most responses  | Human-readable text                                               |
| `data`       | success         | The actual payload (an object or an array)                        |
| `meta`       | paginated lists | `{ page, limit, total, totalPages }`                              |
| `errorCode`  | errors          | Stable machine-readable code                                      |
| `details`    | some errors     | Validation issues, dependency states, or a stack trace (dev only) |

Why copy the status into the body? Some clients and log pipelines only see the body (for example, a proxy that logs responses, or a fetch wrapper that throws the response away). With `statusCode` in the body, the outcome is never lost.

Why **no `success: true/false` field**? Because it would duplicate the status code and could contradict it (`200` with `success: false` is a classic bug). The helpers write the HTTP status and the body field from **one value**, so they cannot drift:

```ts
// src/shared/http/response.ts
export const sendSuccess = <T = unknown>(
  res: Response,
  statusCode: number,
  data?: T,
  message: ResponseMessage = null,
): void => {
  const body: ApiResponse<T> = {
    statusCode,
    ...(message !== null ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  };

  res.status(statusCode).json(body);
};
```

Controllers never call `res.json` directly; they call `sendSuccess`, `sendPaginated` or (in error paths) `sendError`.

### Pagination

Returning "all users" is fine with 10 users and a disaster with 10 million. List endpoints return **one page** at a time. The shared query schema:

```ts
// src/shared/http/pagination.ts
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});
```

- `page` starts at 1, `limit` is 1–100 (the cap protects the database).
- Missing values get defaults (`page=1`, `limit=10`).
- `z.coerce.number()` turns the query string `"2"` into the number `2` (query strings are always text).

`GET /api/v1/users` extends it with `search`, `role`, `sortBy` (`createdAt`, `name`, `email`) and `sortOrder` (`asc`, `desc`). The response's `meta` tells the client how many pages exist:

```json
{
  "statusCode": 200,
  "message": "Users retrieved successfully",
  "data": [
    {
      "id": "...",
      "name": "Ricky",
      "email": "r@x.com",
      "role": "user",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "meta": { "page": 1, "limit": 10, "total": 1, "totalPages": 1 }
}
```

## Step by step: one request, both sides

```
Client                                   Server
  │ POST /api/v1/authentication/register   │
  │ Content-Type: application/json         │
  │ {"name":"Ann","email":"ann@x.com",     │
  │  "password":"correct horse battery"}   │
  │ ─────────────────────────────────────▶ │ 1. parse JSON body
  │                                        │ 2. validate fields (chapter 5)
  │                                        │ 3. create the user, issue tokens
  │                                        │ 4. queue a welcome email (chapter 12)
  │ ◀───────────────────────────────────── │ 5. sendSuccess(res, 201, {...}, "Registered successfully")
  │ HTTP/1.1 201 Created                   │
  │ {"statusCode":201,"message":...,       │
  │  "data":{"accessToken":...,"user":...}}│
```

## Try it yourself

```bash
# See the full request and response (-v prints both)
curl -v http://localhost:3000/api/health/live

# 201: create an account
curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ann","email":"ann@x.com","password":"correct horse battery"}'

# 409: the same email again
curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ann","email":"ann@x.com","password":"correct horse battery"}'
# {"statusCode":409,"message":"Email already exists","errorCode":"EMAIL_ALREADY_EXISTS"}

# 400: malformed JSON
curl -s -X POST http://localhost:3000/api/v1/authentication/login \
  -H 'Content-Type: application/json' -d '{bad'
# {"statusCode":400,"message":"Expected property name or '}' in JSON at position 1 (line 1 column 2)","errorCode":"BAD_REQUEST"}

# 401: protected route without a token
curl -s -i http://localhost:3000/api/v1/authentication/profile | head -1
# HTTP/1.1 401 Unauthorized

# ETag → 304
ETAG=$(curl -s -D - -o /dev/null http://localhost:3000/api/docs/openapi.json | grep -i '^etag' | cut -d' ' -f2 | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" http://localhost:3000/api/docs/openapi.json
# 304

# Compression: the server answers gzip when you accept it
curl -s -D - -o /dev/null -H 'Accept-Encoding: gzip' http://localhost:3000/api/docs/openapi.json | grep -i content-encoding
# Content-Encoding: gzip
```

## Common mistakes

- **Always answering 200** and putting the real outcome in the body. Clients, caches, monitoring and retries all rely on the status code.
- **Using 401 when you mean 403.** 401 = "I don't know who you are", 403 = "I know who you are and you can't do this".
- **Branching on the `message` text** in clients. Messages are for humans and may change; `errorCode` is the contract.
- **Unbounded lists.** Always paginate, and cap `limit`.
- **Breaking changes without a version.** Renaming a field in `/v1` breaks every installed app. Add `/v2`.
- **Verbs in URLs** (`/getUsers`, `/deleteFile/5`). Let the method carry the verb.

## Summary

- HTTP is a request/response conversation: method + path + headers + body, answered by status + headers + body.
- Methods carry meaning; safe and idempotent methods can be retried freely, `POST` cannot (without help).
- 4xx means the client should change the request, 5xx means the server failed.
- Endpoints are designed around resources and versioned under `/api/v1`; health and docs are unversioned.
- Every response uses one envelope, built by `sendSuccess` / `sendPaginated` / `sendError`, with `statusCode` always matching the HTTP status and a stable `errorCode` on errors.

Next: [03 · Express and middleware](03-express-and-middleware.md)
