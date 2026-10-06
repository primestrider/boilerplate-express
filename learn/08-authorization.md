# 08. Authorization

## Goals

By the end of this chapter you will understand:

- how a request goes from "carries a token" to "this user may do this";
- roles, and the `requireRole` middleware;
- **ownership** checks ("you may edit your own profile, admins may edit anyone's"), with `assertOwnerOrRole`;
- when the API answers **401**, **403** or **404**, and why it sometimes prefers 404 to hide that something exists;
- special rules like "admins cannot change their own role";
- why a role change only takes effect with the next token, and how the first admin is created.

## Core concepts

Chapter 7 established **who** the caller is. **Authorization** decides **what** they may do. Two common building blocks:

1. **Role-based access control (RBAC)**: each user has a role, and some actions require a role. Analogy: in a hospital, only staff with the "doctor" badge may prescribe medicine.
2. **Ownership (resource-based) rules**: a user may act on resources that belong to them. Analogy: any patient may read **their own** medical record, not someone else's, while the doctor may read all of them.

Most real APIs combine the two: "the owner **or** an admin".

### 401 vs 403 vs 404

| Status               | Meaning                                                    | Analogy                                                         |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| **401 Unauthorized** | "I don't know who you are" (missing/invalid/expired token) | No badge at the door                                            |
| **403 Forbidden**    | "I know who you are, but you may not do this"              | Valid badge, wrong department                                   |
| **404 Not Found**    | "There is nothing here (for you)"                          | The room does not exist, or you are not allowed to know it does |

The names are historically confusing: "401 Unauthorized" really means **unauthenticated**.

A subtle security point: a **403** for a resource you do not own confirms that the resource **exists**. Sometimes that leak matters (for example, it lets someone probe which ids are valid), so APIs answer **404** instead: "as far as you are concerned, it does not exist". This boilerplate uses both techniques, for reasons explained below.

## In this boilerplate

### Roles: `USER_ROLES`

```ts
// src/modules/users/user.entity.ts
/**
 * Roles, from least to most privileged. Add new roles here; the database
 * column and token claims follow this list.
 */
export const USER_ROLES = ["user", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];
```

This one list drives three things:

- the database column (`mysqlEnum("role", USER_ROLES)` in `src/db/schema.ts`), so MySQL rejects unknown roles;
- the TypeScript type `UserRole` (`"user" | "admin"`), so a typo like `requireRole("admn")` does not compile;
- token verification: `TokenService` only accepts a token whose `role` claim is in the list.

Every registration gets `user` (the column default). There is **no** API to choose your own role at registration: the register schema has no `role` field, and Zod strips unknown keys, so sending `"role": "admin"` is silently ignored.

### Step 1: `authenticate` identifies the caller

```ts
// src/modules/authentication/authenticate.middleware.ts
export const createAuthenticate =
  (tokenService: TokenService): RequestHandler =>
  (req, res, next) => {
    // RFC 6750: a 401 must tell the client which scheme to use.
    res.set("WWW-Authenticate", "Bearer");

    const [scheme, token] = req.get("Authorization")?.split(" ") ?? [];

    if (scheme !== "Bearer" || !token) {
      throw HttpError.unauthorized("Authentication required", {
        errorCode: "UNAUTHORIZED",
      });
    }

    const auth = tokenService.verifyAccessToken(token);
    res.locals.auth = auth;
    res.removeHeader("WWW-Authenticate");

    const context = getRequestContext();
    if (context) context.userId = auth.userId;

    next();
  };
```

- Missing header or wrong scheme → `401 UNAUTHORIZED`; bad or expired token → `401 INVALID_TOKEN` / `TOKEN_EXPIRED` (thrown by `verifyAccessToken`).
- On success, the caller `{ userId, role }` is stored in **`res.locals.auth`**. `res.locals` is Express's per-request scratch space: it lives exactly as long as this request.
- The user id is also put in the request context, so the audit log knows who acted (chapter 14).

Later code reads the caller with `getAuth(res)`:

```ts
export const getAuth = (res: Response): AuthContext => {
  if (!res.locals.auth) {
    throw new Error("getAuth() called on a route without authenticate");
  }

  return res.locals.auth;
};
```

If a developer forgets `authenticate` on a route, `getAuth` throws a plain `Error`, which becomes a 500. That is intentional: it is a programming bug, and failing loudly is much safer than silently treating the caller as anonymous or as someone else.

Note that `authenticate` does **not** query the database. The role comes from the token. This is fast, and its consequence is discussed under "role changes" below.

### Step 2a: role checks with `requireRole`

```ts
// src/modules/authentication/authorize.ts
const forbidden = () =>
  HttpError.forbidden("You do not have permission to perform this action", {
    errorCode: "FORBIDDEN",
  });

export const requireRole =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...roles: UserRole[]): RequestHandler<any, any, any, any> =>
    (_req, res, next) => {
      if (!roles.includes(getAuth(res).role)) {
        throw forbidden();
      }

      next();
    };
```

It is a **middleware factory**: `requireRole("admin")` returns a middleware that lets admins through and answers `403 FORBIDDEN` to everyone else. It must come **after** `authenticate`, because it reads `getAuth(res)`.

Where it is used:

```ts
// src/modules/users/user.routes.ts
router.use(authenticate);

router.get("/", requireRole("admin"), validate({ query: listUsersQuerySchema }), userController.findAll);
...
router.patch("/:id/role", requireRole("admin"), validate({ params: userIdParamsSchema, body: updateUserRoleSchema }), userController.changeRole);
```

```ts
// src/modules/audit/audit.routes.ts
router.use(authenticate, requireRole("admin"));
```

`router.use(...)` applies the middleware to **every** route of that router: all users routes need a token, and every audit-log route is admin-only.

Notice the order on `GET /users`: `requireRole` runs **before** `validate`. A regular user sending a malformed query gets `403`, not `400`: we do not spend effort (or reveal validation rules) for callers who are not allowed in anyway.

### Step 2b: ownership checks with `assertOwnerOrRole`

```ts
// src/modules/authentication/authorize.ts
/**
 * Throws 403 unless the caller owns the resource or has one of the roles.
 * Call it before loading the resource, so the answer never reveals whether a
 * resource owned by another user exists.
 */
export const assertOwnerOrRole = (
  auth: AuthContext,
  ownerId: string,
  ...roles: UserRole[]
) => {
  if (auth.userId !== ownerId && !roles.includes(auth.role)) {
    throw forbidden();
  }
};
```

Unlike `requireRole`, this is a plain function, not a middleware, because the owner is only known from the request's data. In the users controller, the "resource" **is** a user, so its owner id is simply the `:id` in the URL:

```ts
// src/modules/users/user.controller.ts
findById: RequestHandler<UserIdParamsDto> = async (req, res) => {
  assertOwnerOrRole(getAuth(res), req.params.id, "admin");

  const user = await this.userService.findById(req.params.id);
  ...
};
```

The check happens **before** loading the user. Consider a regular user asking for two ids that are not theirs:

| Request by a regular user             | Check before loading (this code) | If we loaded first        |
| ------------------------------------- | -------------------------------- | ------------------------- |
| `GET /users/<another real user>`      | 403                              | 403                       |
| `GET /users/<id that does not exist>` | 403                              | **404** ← leaks existence |

Because every non-owner gets 403 regardless, the response never reveals whether a given user id exists. Admins, who may see everything, get the honest 404 for unknown ids. The same pattern protects `PATCH /users/:id` and `DELETE /users/:id`.

### The files module: 404 instead of 403

For files, the owner is **not** in the URL: `GET /files/:id` only has the file id. The service must load the file to learn who owns it, so "check before loading" is impossible. Answering 403 after loading would confirm the file exists. So the files service answers **404** to anyone who is neither the owner nor an admin:

```ts
// src/modules/files/file.service.ts
async findById(auth: AuthContext, id: string): Promise<StoredFile> {
  const file = await this.repository.findById(id);

  if (!file || (file.ownerId !== auth.userId && auth.role !== "admin")) {
    throw HttpError.notFound("File not found", {
      errorCode: "FILE_NOT_FOUND",
    });
  }

  return file;
}
```

"Does not exist" and "not yours" become indistinguishable. Download and delete both go through this method, so they inherit the rule. Listing (`GET /files`) only ever queries the caller's own files (`findByOwner(getAuth(res).userId, ...)`), so there is nothing to hide there.

Both modules reach the same goal (**never reveal another user's resources**) with the technique that fits where the owner id is known.

### Summary of protections per route

| Route                            | Who may call                        | Enforced by                                      |
| -------------------------------- | ----------------------------------- | ------------------------------------------------ |
| `GET /v1/users`                  | admin                               | `requireRole("admin")`                           |
| `GET/PATCH/DELETE /v1/users/:id` | owner or admin                      | `assertOwnerOrRole` in the controller            |
| `PATCH /v1/users/:id/role`       | admin, not on themselves            | `requireRole("admin")` + rule in `UserService`   |
| `GET/POST /v1/files`             | any authenticated user (own files)  | `authenticate`; queries filtered by owner        |
| `GET/DELETE /v1/files/:id[...]`  | owner or admin (others get 404)     | `FileService.findById`                           |
| `GET /v1/audit-logs`             | admin                               | `router.use(authenticate, requireRole("admin"))` |
| `GET /v1/authentication/profile` | any authenticated user (themselves) | `authenticate`                                   |

### Business rule: admins cannot change their own role

```ts
// src/modules/users/user.service.ts
async changeRole(actorId: string, id: string, role: UserRole): Promise<User> {
  if (actorId === id) {
    throw HttpError.badRequest("You cannot change your own role", {
      errorCode: "CANNOT_CHANGE_OWN_ROLE",
    });
  }

  const user = await this.findById(id);
  const previousRole = user.role;

  if (previousRole === role) return user;

  await this.userRepository.updateRole(id, role);
  await this.auditService.record({
    action: "user.role_changed",
    entityType: "user",
    entityId: id,
    metadata: { from: previousRole, to: role },
  });

  return { ...user, role };
}
```

Why? If the only admin demoted themselves by mistake, nobody could manage roles anymore (except through the CLI). Requiring **another** admin to change your role prevents that lock-out. This rule lives in the **service**, not the route, because it is a business rule about the data, not about who may call the endpoint. Setting a role a user already has is a no-op and writes no audit entry.

### Role changes take effect with the next token

Since `authenticate` trusts the role inside the JWT, a user promoted to admin still carries `"role":"user"` in their current access token. The new role arrives when:

- the access token expires and the client calls `/refresh` (refresh re-reads the user from the database and signs the current role), or
- the user logs in again.

The same delay applies to demotions: a demoted admin keeps admin rights until their access token expires, at most `JWT_TTL_SECONDS` (15 minutes by default). This is the deliberate trade-off of stateless tokens: no database lookup per request, in exchange for a short window. If your application cannot tolerate that window, you would check the role in the database on sensitive routes, or shorten the TTL.

### Creating the first admin: the CLI

There must be a way to get the first admin without an admin. That is `src/cli/make-admin.ts`:

```bash
npm run user:make-admin -- someone@example.com     # development
node dist/cli/make-admin.js someone@example.com    # after a build / in a container
```

It finds the user by email, sets `role = admin`, and writes a `user.role_changed` audit entry with `actorId: null` and `metadata: { from, to, via: "cli" }`, so even out-of-band promotions are traceable. Running it on someone already an admin just prints `... is already an admin`.

Two notes from the code comments:

- The user must refresh or log in again to get a token with the new role (see above).
- The CLI writes directly to the database, bypassing the user cache, so with Redis enabled a cached copy of the user may show the old role for up to a minute (chapter 10).

## Step by step: `PATCH /api/v1/users/:id` by a regular user

```
1. authenticate         → token valid → res.locals.auth = { userId: "A", role: "user" }
2. validate             → :id is a UUID, body has name and/or email
3. controller.update    → assertOwnerOrRole(auth, ":id", "admin")
                            :id === "A"  → allowed, continue
                            :id !== "A"  → 403 FORBIDDEN (nothing loaded, nothing revealed)
4. userService.update   → email uniqueness, update, audit "user.updated"
5. response 200 with the updated user
```

## Try it yourself

Register two users and keep their tokens:

```bash
BASE=http://localhost:3000/api/v1
reg() {
  curl -s -X POST $BASE/authentication/register -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"correct horse battery\"}"
}
ALICE=$(reg Alice alice@x.com); BOB=$(reg Bob bob@x.com)
ALICE_TOKEN=$(echo "$ALICE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
BOB_ID=$(echo "$BOB" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.user.id')
```

1. **401**: no token.

   ```bash
   curl -s $BASE/users/$BOB_ID
   # {"statusCode":401,"message":"Authentication required","errorCode":"UNAUTHORIZED"}
   ```

2. **403**: Alice reads Bob, and Alice reads an id that does not exist. Both answers are identical.

   ```bash
   curl -s $BASE/users/$BOB_ID -H "Authorization: Bearer $ALICE_TOKEN"
   curl -s $BASE/users/00000000-0000-4000-8000-000000000000 -H "Authorization: Bearer $ALICE_TOKEN"
   # {"statusCode":403,"message":"You do not have permission to perform this action","errorCode":"FORBIDDEN"}
   ```

3. **403** on an admin-only route:

   ```bash
   curl -s $BASE/users -H "Authorization: Bearer $ALICE_TOKEN"
   curl -s $BASE/audit-logs -H "Authorization: Bearer $ALICE_TOKEN"
   ```

4. **Make Alice an admin**, then notice her **old** token still says `user`:

   ```bash
   npm run user:make-admin -- alice@x.com
   curl -s $BASE/users -H "Authorization: Bearer $ALICE_TOKEN"   # still 403
   ALICE_TOKEN=$(curl -s -X POST $BASE/authentication/login -H 'Content-Type: application/json' \
     -d '{"email":"alice@x.com","password":"correct horse battery"}' \
     | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')
   curl -s $BASE/users -H "Authorization: Bearer $ALICE_TOKEN"   # now 200
   ```

5. **Own role rule**:

   ```bash
   ALICE_ID=$(echo "$ALICE" | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.user.id')
   curl -s -X PATCH $BASE/users/$ALICE_ID/role -H "Authorization: Bearer $ALICE_TOKEN" \
     -H 'Content-Type: application/json' -d '{"role":"user"}'
   # {"statusCode":400,"message":"You cannot change your own role","errorCode":"CANNOT_CHANGE_OWN_ROLE"}
   ```

6. **Files answer 404 to non-owners**: upload a PNG as Bob (see chapter 13 for the command), then request it with a token of a third, non-admin user: you get `404 FILE_NOT_FOUND`, exactly as for a random id.

## Common mistakes

- **Only hiding buttons in the frontend.** Anyone can call the API directly; every rule must be enforced on the server.
- **Trusting ids or roles from the request body** (`{"userId": "...", "role": "admin"}`). The caller's identity comes only from the verified token (`getAuth(res)`).
- **Checking ownership after loading and answering 403**, which leaks which resources exist. Check before loading when the owner is known from the URL, or answer 404.
- **Forgetting `authenticate` on a new router.** Use `router.use(authenticate)` at the top of routers whose routes are all protected; `getAuth` fails loudly if you forget.
- **Letting admins lock themselves out** (demoting the last admin).
- **Expecting role changes to apply instantly** with stateless JWTs.

## Summary

- `authenticate` turns a bearer token into `res.locals.auth = { userId, role }`; `getAuth(res)` reads it and fails loudly when misused.
- `requireRole(...)` is a middleware for role rules; `assertOwnerOrRole(...)` is a function for "owner or admin" rules.
- 401 = not authenticated, 403 = authenticated but not allowed, 404 = not found (or deliberately hidden).
- Users are checked before loading (owner id is in the URL); files answer 404 to non-owners (owner only known after loading). Both avoid revealing other users' resources.
- Admins cannot change their own role; role changes reach the token on the next refresh or login.
- The first admin is created with `npm run user:make-admin -- <email>`, which is also audited.

Next: [09. Application security](09-security.md)
