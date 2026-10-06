# 07. Authentication

## Goals

By the end of this chapter you will understand:

- the difference between **authentication** and **authorization**;
- why passwords are hashed (not encrypted), and why Argon2id;
- how the login flow avoids leaking which emails exist, even through timing;
- what a JWT is, what is inside one, and how it is verified safely;
- why there are two tokens (access and refresh), and how refresh-token rotation detects stolen tokens;
- how logout, password change and account deletion end sessions;
- where a client should keep its tokens.

## Core concepts

### Authentication vs authorization

- **Authentication** answers **"who are you?"** (proving identity, e.g. with a password).
- **Authorization** answers **"what are you allowed to do?"** (permissions, e.g. only admins may list users).

Analogy: at an airport, showing your passport is authentication; your boarding pass deciding which plane you may board is authorization. This chapter covers the passport; chapter 8 covers the boarding pass.

### Never store passwords, store hashes

If the database leaks (backups, a SQL injection somewhere, a careless employee), plain-text passwords would expose every user, on every site where they reused the password. So the app stores a **hash** instead.

- **Encryption** is reversible: with the key you get the original back. If the key leaks with the data, everything is exposed.
- **Hashing** is one-way: `hash("secret")` always gives the same output, but you cannot compute `"secret"` from the output. To check a login, you hash the attempt and compare.

General-purpose hashes like SHA-256 are designed to be **fast**, which is exactly wrong for passwords: an attacker with a leaked database can try billions of guesses per second. **Password hashing functions** (Argon2, bcrypt, scrypt) are deliberately **slow and memory-hungry**, and they add a random **salt** (a per-password random value) so identical passwords produce different hashes and precomputed tables are useless.

**Argon2id** won the Password Hashing Competition and is OWASP's first recommendation.

### Tokens instead of sending the password every time

After login, the client should not send the password with every request. Instead the server hands out a **token**: a string that proves "the bearer of this logged in as user X". The client sends it in a header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

"Bearer" means "whoever holds (bears) this token is treated as the user", like a cinema ticket: nobody checks your ID, only the ticket. So tokens must be kept secret and should not live long.

### JWT: a signed, self-contained token

A **JWT** (JSON Web Token) has three parts separated by dots: `header.payload.signature`. Each part is **base64url**-encoded (a text-safe encoding, **not** encryption: anyone can decode it).

Decoding a real access token from this app:

```
header:    {"alg":"HS256","typ":"JWT"}
payload:   {"role":"user","iat":1791262354,"exp":1791263254,"sub":"10c9e604-ee00-4984-8dab-3084cfe62fc7"}
signature: <HMAC-SHA256 of "header.payload" using JWT_SECRET>
```

- `sub` (subject): the user id.
- `role`: a custom claim used for authorization.
- `iat` (issued at) and `exp` (expires at): Unix timestamps in seconds. Here `exp - iat = 900`, i.e. 15 minutes.

The **signature** is what makes a JWT trustworthy. **HS256** = HMAC with SHA-256: the server computes a keyed hash of `header.payload` with its secret (`JWT_SECRET`). If anyone changes even one character of the payload (say `"role":"admin"`), the signature no longer matches, and verification fails. Because only the server knows the secret, only the server can create valid tokens.

Since the payload is readable by anyone, **never put secrets in a JWT** (no password hash, no personal data beyond what is needed).

**Stateless**: the server can verify a JWT with math alone, without a database lookup. That is fast, but it also means the server cannot "take back" a JWT before it expires. The solution is to keep access tokens short-lived and pair them with a **refresh token**.

### Access token + refresh token

| Token         | Lifetime                                    | Format        | Stored by server? | Sent with                     |
| ------------- | ------------------------------------------- | ------------- | ----------------- | ----------------------------- |
| Access token  | short (`JWT_TTL_SECONDS`, 15 min)           | JWT           | No (stateless)    | every API request             |
| Refresh token | long (`REFRESH_TOKEN_TTL_SECONDS`, 30 days) | random string | Yes, as a hash    | only `/refresh` and `/logout` |

If an access token leaks, it is useful for at most 15 minutes. The refresh token is long-lived but rarely sent over the wire, and because the server stores it, the server **can** revoke it.

## In this boilerplate

All of this lives in `src/modules/authentication/`.

### Password hashing: `password.ts`

```ts
// src/modules/authentication/password.ts
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string) =>
  argon2.hash(password, HASH_OPTIONS);

export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password);

export const needsRehash = (hash: string) =>
  argon2.needsRehash(hash, HASH_OPTIONS);
```

These are OWASP's recommended Argon2id parameters: 19 MiB of memory, 2 iterations, 1 lane. The stored hash is self-describing and includes the algorithm, parameters and random salt:

```
$argon2id$v=19$m=19456,p=1,t=2$<salt>$<hash>
```

Because the parameters are inside the hash, you can **raise them later** without breaking old passwords: old hashes still verify with their own parameters, and `needsRehash` tells the login flow to upgrade them:

```ts
// authentication.service.ts, inside login()
if (needsRehash(user.passwordHash)) {
  await this.userRepository.updatePasswordHash(
    user.id,
    await hashPassword(input.password),
  );
}
```

The upgrade can only happen at login, because that is the only moment the server sees the plain password.

Password rules come from `authentication.schema.ts`:

```ts
const password = z.string().min(8).max(128);
```

At least 8 characters (OWASP minimum), at most 128: Argon2 cost does not grow with length much, but an upper bound stops someone sending megabytes of "password". Login uses `z.string().min(1).max(128)` with **no** length rules, because enforcing the policy at login would only reveal it to attackers.

### Login without leaking information

A login form can leak whether an email is registered in two ways:

1. **Different messages**: "no such user" vs "wrong password". Attackers use that to build lists of valid accounts.
2. **Different timing**: if the server returns instantly for an unknown email but spends ~50 ms hashing for a known one, response time reveals the answer. This is a **timing attack**.

The service closes both:

```ts
// src/modules/authentication/authentication.service.ts
private readonly dummyHash = hashPassword("dummy-password-for-timing");

async login(input: LoginDto): Promise<AuthenticationResult> {
  const user = await this.userRepository.findByEmail(input.email);

  if (!user) {
    await verifyPassword(await this.dummyHash, input.password);
    await this.recordFailedLogin(null);
    throw invalidCredentials();
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    await this.recordFailedLogin(user.id);
    throw invalidCredentials();
  }
  ...
}
```

- For an unknown email the service still runs an Argon2 verification against a **dummy hash**, so both failure paths cost about the same time.
- Both paths throw the same error: `401 INVALID_CREDENTIALS` with message `"Invalid email or password"`.
- Both are recorded in the audit log as `auth.login_failed` (chapter 14).

Registration cannot hide existence entirely (it must say `409 EMAIL_ALREADY_EXISTS`), which is one reason register shares the strict rate limiter described below.

### Issuing and verifying tokens: `token.service.ts`

```ts
signAccessToken(userId: string, role: UserRole): AccessToken {
  const accessToken = jwt.sign({ role }, this.options.secret, {
    algorithm: "HS256",
    subject: userId,
    expiresIn: this.options.accessTokenTtlSeconds,
  });

  return { accessToken, tokenType: "Bearer", expiresIn: this.options.accessTokenTtlSeconds };
}
```

Verification is the security-critical part:

```ts
verifyAccessToken(token: string): AuthContext {
  try {
    // Pinning the algorithm blocks "alg: none" and algorithm-confusion
    // tokens.
    const payload = jwt.verify(token, this.options.secret, {
      algorithms: ["HS256"],
    });

    if (typeof payload === "string" || !payload.sub || !isUserRole(payload.role)) {
      throw new jwt.JsonWebTokenError("Malformed token payload");
    }

    return { userId: payload.sub, role: payload.role };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw HttpError.unauthorized("Access token has expired", { errorCode: "TOKEN_EXPIRED" });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw HttpError.unauthorized("Invalid access token", { errorCode: "INVALID_TOKEN" });
    }
    throw error;
  }
}
```

- **Pinned algorithm** (`algorithms: ["HS256"]`): the JWT header says which algorithm was used, and that header is attacker-controlled. Historic attacks set `"alg": "none"` (no signature at all) or switched algorithms to trick a library. Accepting only HS256 closes that door.
- **Payload shape check**: even a correctly signed token must have a `sub` and a known role.
- **Different error codes**: `TOKEN_EXPIRED` tells a well-behaved client "call `/refresh` now"; `INVALID_TOKEN` means "log in again".

`JWT_SECRET` must be at least 32 characters (`src/config/env.ts`). HMAC is only as strong as its key; a short or guessable secret lets attackers brute-force it offline from any token and then forge admin tokens. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Refresh tokens: random, stored as a hash

```ts
export const hashRefreshToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

createRefreshToken(): RefreshToken {
  const token = randomBytes(32).toString("base64url");

  return {
    token,
    hash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + this.options.refreshTokenTtlSeconds * 1000),
  };
}
```

- The token is 32 random bytes (256 bits) from a cryptographically secure generator. It is **opaque**: it means nothing by itself, it is just a lookup key.
- The database stores only its **SHA-256 hash** (`refresh_tokens.token_hash`). If the table leaks, the attacker gets hashes, which cannot be used as tokens.
- **Why is fast SHA-256 fine here when it was wrong for passwords?** Passwords are guessable (people choose `summer2024`), so slowness matters. A 256-bit random value cannot be guessed: even at a trillion guesses per second, the search would outlast the universe. Fast hashing also keeps lookups cheap.

### Rotation and reuse detection

Each refresh token works **once**. Calling `/refresh` returns a new pair and retires the old refresh token. All tokens descending from one login share a `familyId` (one family = one session, e.g. one device).

Why rotate? Imagine an attacker steals a refresh token. Now two parties hold it: the real user and the attacker. Whoever refreshes first gets a new token; when the other one later presents the **old** token, the server sees a token that was already used. That can only happen if the token was copied, so the server **revokes the whole family**, kicking out both the attacker and the user (who simply logs in again).

```mermaid
sequenceDiagram
    participant U as User
    participant A as Attacker
    participant S as Server
    U->>S: login
    S-->>U: refresh token R1 (family F)
    Note over A: steals R1
    A->>S: POST /refresh R1
    S-->>A: new pair, R2 (R1 revoked)
    U->>S: POST /refresh R1 (still has the old one)
    Note over S: R1 already revoked = reuse!<br/>revoke every token of family F
    S-->>U: 401 INVALID_REFRESH_TOKEN
    A->>S: POST /refresh R2
    S-->>A: 401 INVALID_REFRESH_TOKEN (family revoked)
```

The code:

```ts
async refresh({ refreshToken }: RefreshDto): Promise<AuthenticationResult> {
  const stored = await this.refreshTokenRepository.findByHash(hashRefreshToken(refreshToken));

  if (!stored || stored.expiresAt <= new Date()) {
    throw invalidRefreshToken();
  }

  if (!(await this.refreshTokenRepository.revokeIfActive(stored.id))) {
    await this.refreshTokenRepository.revokeFamily(stored.familyId);
    logger.warn("Refresh token reuse detected, session revoked", {...});
    await this.auditService.record({ action: "auth.refresh_token_reused", ... });
    throw invalidRefreshToken();
  }

  // A deleted user's tokens stay in the table but are useless from here.
  const user = await this.userRepository.findById(stored.userId);

  if (!user) throw invalidRefreshToken();

  return { user, ...(await this.issueTokens(user, stored.familyId)) };
}
```

`revokeIfActive` is the atomic conditional `UPDATE` from chapter 6: if two requests refresh the same token at the same instant, exactly one wins and the other is treated as reuse. The new pair is issued with the **same** `familyId`, so the session continues.

Note the refresh also re-reads the user. That is how a **role change** reaches the token: the new access token is signed with the current role from the database.

All failure cases answer the same `401 INVALID_REFRESH_TOKEN` ("Invalid or expired refresh token"): unknown, expired, reused, or belonging to a deleted user.

### Logout, password change and deleted accounts

- **Logout** (`POST /logout` with the refresh token) revokes the token's family, i.e. this one session. Other devices stay logged in. Unknown tokens are silently ignored, so the endpoint reveals nothing about which tokens exist: it always answers `200 "Logged out successfully"`.
- **Change password** (`POST /change-password`, requires an access token) checks the current password, stores a new hash, and calls `revokeAllForUser`, ending **every** session. Whoever might know the old password is signed out everywhere. A notification email is queued too (chapter 12).

  ```ts
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw HttpError.badRequest("Current password is incorrect", {
      errorCode: "INVALID_CURRENT_PASSWORD",
    });
  }
  await this.userRepository.updatePasswordHash(
    user.id,
    await hashPassword(newPassword),
  );
  await this.refreshTokenRepository.revokeAllForUser(user.id);
  ```

  The schema also refuses a new password equal to the current one (`"New password must differ from the current one"` on `newPassword`).

- **Deleted users** (soft delete) are invisible to `findByEmail` and `findById`, so they cannot log in or refresh. Their already-issued access tokens keep working until they expire (at most 15 minutes): that is the trade-off of stateless JWTs.

### Brute-force protection: the credentials limiter

`register`, `login`, `refresh` and `change-password` share a strict per-IP limiter (`src/config/rate-limit.config.ts`):

```ts
export const createAuthenticationLimiter = (redis?: Redis) =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 10,
    skipSuccessfulRequests: true,
    ...
  });
```

`skipSuccessfulRequests` means only **failed** responses (status ≥ 400) count. A user who logs in correctly is never blocked; someone guessing passwords gets 10 tries per 15 minutes per IP, then `429 TOO_MANY_REQUESTS` ("Too many attempts, please try again later."). Chapter 9 explains rate limiting in general.

### The response of register, login and refresh

```json
{
  "statusCode": 200,
  "message": "Logged in successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "tokenType": "Bearer",
    "expiresIn": 900,
    "refreshToken": "q3N0...43 chars...",
    "refreshExpiresIn": 2592000,
    "user": {
      "id": "...",
      "name": "Ricky",
      "email": "r@x.com",
      "role": "user",
      "createdAt": "...",
      "updatedAt": "..."
    }
  }
}
```

Register answers `201` with `"Registered successfully"`; refresh answers `200` with `"Token refreshed successfully"`.

## Step by step: a full session

```
1. POST /register  → hash password (Argon2id) → insert user → audit auth.registered
                     → queue welcome email → issue tokens (new familyId)   → 201
2. GET  /profile   with access token → authenticate() verifies the JWT (no DB) → 200
   ... 15 minutes pass ...
3. GET  /profile   → 401 TOKEN_EXPIRED
4. POST /refresh   with refresh token → find by hash → revokeIfActive ✅
                     → re-read user → issue new pair (same familyId)       → 200
5. GET  /profile   with the new access token → 200
6. POST /logout    with the newest refresh token → revoke the family      → 200
7. POST /refresh   with that token → 401 INVALID_REFRESH_TOKEN
```

## Try it yourself

```bash
BASE=http://localhost:3000/api/v1/authentication
# Reads a field from JSON on stdin, e.g. `... | json data.accessToken`
json() { node -pe "JSON.parse(require('fs').readFileSync(0)).$1"; }

# 1. Register
REG=$(curl -s -X POST $BASE/register -H 'Content-Type: application/json' \
  -d '{"name":"Ricky","email":"ricky@x.com","password":"correct horse battery"}')
ACCESS=$(echo "$REG" | json data.accessToken)
REFRESH=$(echo "$REG" | json data.refreshToken)

# 2. Decode the access token payload (no secret needed: it is only encoded)
echo "$ACCESS" | cut -d. -f2 | node -pe 'Buffer.from(require("fs").readFileSync(0,"utf8").trim(),"base64url").toString()'

# 3. Use it
curl -s $BASE/profile -H "Authorization: Bearer $ACCESS"

# 4. Tamper with it: change one character of the signature
curl -s $BASE/profile -H "Authorization: Bearer ${ACCESS%?}x"
# → {"statusCode":401,"message":"Invalid access token","errorCode":"INVALID_TOKEN"}

# 5. Same message for unknown email and wrong password
curl -s -X POST $BASE/login -H 'Content-Type: application/json' -d '{"email":"nobody@x.com","password":"whatever"}'
curl -s -X POST $BASE/login -H 'Content-Type: application/json' -d '{"email":"ricky@x.com","password":"wrong password"}'
# both → {"statusCode":401,"message":"Invalid email or password","errorCode":"INVALID_CREDENTIALS"}

# 6. Rotate, then reuse the old refresh token
NEW_REFRESH=$(curl -s -X POST $BASE/refresh -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}" | json data.refreshToken)
curl -s -X POST $BASE/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}"
# → 401 INVALID_REFRESH_TOKEN (reuse detected, family revoked)
curl -s -X POST $BASE/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$NEW_REFRESH\"}"
# → 401 as well: the whole session was revoked
```

Look at the database afterwards:

```bash
docker compose exec mysql mysql -uapp -papp app \
  -e "SELECT family_id, revoked_at, expires_at FROM refresh_tokens;"
```

Every token of the family now has a `revoked_at`. The audit log contains an `auth.refresh_token_reused` entry.

7. **Trigger the credentials limiter**: send the wrong-password login 11 times; the 11th answers `429 TOO_MANY_REQUESTS`.

## Where should the client keep its tokens?

- **Access token**: in memory (a JavaScript variable) is safest. It is short-lived, so losing it on page reload is fine: call `/refresh`.
- **Refresh token** in a browser: `localStorage` can be read by any script on the page, so a single XSS bug (injected JavaScript) steals it. The safer pattern is a small backend-for-frontend (BFF) that keeps the refresh token in an `HttpOnly`, `Secure`, `SameSite` cookie, which scripts cannot read. This API returns tokens in the JSON body so mobile apps and server-to-server clients work; a browser app should put such a BFF/proxy in front.
- **Mobile apps**: the platform's secure storage (Keychain on iOS, Keystore on Android).

## Common mistakes

- **Hashing passwords with SHA-256/MD5**, or worse, encrypting them. Use Argon2id, bcrypt or scrypt.
- **Telling the user "email not found"** on login, or returning faster for unknown emails.
- **Not pinning the JWT algorithm**, or using a short `JWT_SECRET`.
- **Long-lived access tokens** (days or weeks) with no way to revoke them.
- **Storing refresh tokens in plain text**: a database leak becomes a session takeover.
- **Not rotating refresh tokens**: a stolen one works silently for its whole lifetime.
- **Putting sensitive data in the JWT payload**: it is readable by anyone.
- **Forgetting to end sessions after a password change.**

## Summary

- Authentication proves identity; authorization decides permissions.
- Passwords are stored as Argon2id hashes with OWASP parameters and upgraded transparently at login.
- Login answers identically (message and timing) for unknown emails and wrong passwords.
- Access tokens are short-lived HS256 JWTs verified with a pinned algorithm; refresh tokens are random, stored hashed, and rotate on every use.
- Reusing a retired refresh token revokes the whole session; logout ends one session; a password change ends all of them.
- Credential endpoints are limited to 10 failures per IP per 15 minutes.

Next: [08. Authorization](08-authorization.md)
