# 13. File Uploads

## Goals

By the end of this chapter you will understand:

- How files travel over HTTP (`multipart/form-data`).
- How **multer** parses uploads and enforces limits.
- Why the file name and `Content-Type` sent by the client must never be trusted, and how **magic bytes** detect the real type.
- The `FileStorage` abstraction and how `LocalFileStorage` stays safe from path traversal.
- How a download is streamed, and why it is sent as an attachment.
- How upload errors are turned into clear responses.

## Core concepts

### How a file travels over HTTP

JSON bodies cannot carry binary data well. HTML forms (and API clients) send files with the content type **`multipart/form-data`**: the body is split into **parts**, each with its own small headers, separated by a random **boundary** string.

```
POST /api/v1/files
Content-Type: multipart/form-data; boundary=----X1y2

------X1y2
Content-Disposition: form-data; name="file"; filename="photo.png"
Content-Type: image/png

<the raw bytes of the file>
------X1y2--
```

Notice that the client says what the file is called (`filename`) and what it is (`Content-Type`). **Both are just claims by the client.** Anyone can upload a script named `photo.png` with `Content-Type: image/png`.

### Magic bytes

Most file formats start with a fixed sequence of bytes, a **signature** or **magic number**. A PNG always begins with `89 50 4E 47 0D 0A 1A 0A` (`\x89PNG\r\n\x1a\n`); a PDF with `%PDF-`. Checking the first bytes tells you what the content really is, regardless of the name. It is like checking a passport photo against the person's face instead of trusting the name they tell you.

### Why uploads are risky

An upload endpoint lets strangers put data on your server. Typical attacks:

- **Disguised files**: HTML or SVG containing scripts, served back from your domain, can run JavaScript in other users' browsers (stored XSS).
- **Path traversal**: a file name like `../../etc/passwd` used to build a path can write or read outside the upload folder.
- **Huge uploads**: filling memory or disk (denial of service).
- **Reading other users' files** by guessing ids.

The boilerplate defends against each of these.

## In this boilerplate

The files module lives in `src/modules/files/`, with storage in `src/shared/storage/file-storage.ts`. Endpoints (all require a token):

| Method | Path                        | Purpose                        |
| ------ | --------------------------- | ------------------------------ |
| POST   | `/api/v1/files`             | Upload one file (field `file`) |
| GET    | `/api/v1/files`             | List the caller's files        |
| GET    | `/api/v1/files/:id`         | File metadata (owner or admin) |
| GET    | `/api/v1/files/:id/content` | Download the bytes             |
| DELETE | `/api/v1/files/:id`         | Delete (owner or admin)        |

### Parsing with multer

`src/modules/files/file.routes.ts`:

```ts
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxFileBytes, files: 1, fields: 5, parts: 6 },
  // Browsers send UTF-8 file names without declaring a charset.
  defParamCharset: "utf8",
}).single("file");
```

- **multer** is the Express middleware that reads multipart bodies. (`express.json()` in `app.ts` only parses JSON, so uploads are parsed per route.)
- `memoryStorage()` keeps the file in a `Buffer` in memory, available as `req.file.buffer`. That is simple and lets us inspect the bytes before storing them. It is only appropriate for small files: the limit is `UPLOAD_MAX_BYTES` (default 5 MiB). For large files you would stream to disk or object storage instead.
- `limits` caps the file size, allows only **one** file, and limits the number of other fields and parts, so a client cannot send thousands of parts.
- `defParamCharset: "utf8"`: browsers send non-ASCII file names (like `foto-ü.png`) as UTF-8 without saying so; multer's default (latin1) would garble them.
- `.single("file")` expects the file in the form field named `file`.

### The upload flow in the service

`src/modules/files/file.service.ts`:

```ts
async upload(ownerId: string, input: UploadInput): Promise<StoredFile> {
  const mimeType = detectMimeType(input.data);

  if (!mimeType) {
    throw new HttpError(
      `Unsupported file type. Allowed: ${ALLOWED_MIME_TYPES.join(", ")}`,
      { statusCode: StatusCodes.UNSUPPORTED_MEDIA_TYPE, errorCode: "UNSUPPORTED_FILE_TYPE" },
    );
  }

  const storageKey = randomUUID();
  await this.storage.save(storageKey, input.data);

  let file: StoredFile;
  try {
    file = await this.repository.create({ ownerId, originalName: ..., mimeType, size: ..., storageKey });
  } catch (error) {
    // Do not leave orphaned bytes behind when the metadata insert fails.
    await this.storage.delete(storageKey);
    throw error;
  }
  // ... audit "file.uploaded", return file
}
```

1. **Detect the real type** from the bytes. Unknown → `415 UNSUPPORTED_FILE_TYPE`.
2. **Generate the storage name** (`randomUUID()`). The client's file name is **never** used as a path; it is only saved as metadata (`originalName`, truncated to 255 characters).
3. **Save the bytes**, then **insert the metadata row** in MySQL.
4. If the insert fails, **delete the bytes** again, so storage does not fill with orphan files nobody can reach.
5. Record an audit entry (chapter 14).

Notice the `mimeType` stored in the database is the **detected** one, not the client's claim.

### Magic-byte detection

`src/modules/files/file-type.ts`:

```ts
const SIGNATURES: Signature[] = [
  {
    mimeType: "image/png",
    parts: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  },
  { mimeType: "image/jpeg", parts: [[0, [0xff, 0xd8, 0xff]]] },
  { mimeType: "image/gif", parts: [[0, ascii("GIF8")]] },
  // RIFF<4-byte size>WEBP
  {
    mimeType: "image/webp",
    parts: [
      [0, ascii("RIFF")],
      [8, ascii("WEBP")],
    ],
  },
  { mimeType: "application/pdf", parts: [[0, ascii("%PDF-")]] },
];
```

Each signature is a list of `[offset, bytes]` pairs that must **all** match. WebP is the interesting one: it starts with `RIFF` (a generic container also used by WAV audio), then 4 bytes of size, then `WEBP` at offset 8. Checking only `RIFF` would accept a WAV file, so WebP needs two parts.

```ts
export const detectMimeType = (data: Buffer): string | null =>
  SIGNATURES.find(({ parts }) => parts.every((part) => matches(data, part)))
    ?.mimeType ?? null;
```

The list is an **allowlist**: only these five types are accepted. Anything else, including HTML, SVG, scripts and executables, is rejected. Allowlists are safer than blocklists, because you cannot forget a dangerous type you never thought of.

### The storage abstraction

`src/shared/storage/file-storage.ts` defines what any storage must do:

```ts
export interface FileStorage {
  save(key: string, data: Buffer): Promise<void>;
  /** Opens the file; rejects (e.g. ENOENT) before any byte is streamed. */
  read(key: string): Promise<Readable>;
  /** Removes the file; a missing file is not an error. */
  delete(key: string): Promise<void>;
}
```

The service only knows this interface. Today `LocalFileStorage` writes to the folder `UPLOAD_DIR`; tomorrow an `S3FileStorage` could put objects in Amazon S3, and nothing else would change.

`LocalFileStorage` has three safety details:

```ts
const SAFE_KEY = /^[A-Za-z0-9-]{1,64}$/;

private pathOf(key: string) {
  if (!SAFE_KEY.test(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return path.join(this.root, key);
}
```

1. **Path traversal defense.** Keys are generated UUIDs, so they never contain `/` or `..`. Still, `pathOf` refuses anything that is not letters, digits and dashes. This is **defense in depth**: a second lock even though the first one (generated keys) should be enough.

```ts
await writeFile(this.pathOf(key), data, { flag: "wx" });
```

2. **`"wx"` flag**: "write, but fail if the file exists". A reused key can never silently overwrite someone's file.

```ts
async read(key: string): Promise<Readable> {
  const handle = await open(this.pathOf(key), "r");
  return handle.createReadStream();
}
```

3. **Open before streaming.** `read` first opens the file (which fails right away if it is missing), and only then returns a stream. Why this matters is explained in the download section.

### Downloading with a stream

`src/modules/files/file.controller.ts`:

```ts
download: RequestHandler<FileIdParamsDto> = async (req, res) => {
  const { file, content } = await this.fileService.open(
    getAuth(res),
    req.params.id,
  );

  res.status(StatusCodes.OK);
  res.type(file.mimeType);
  res.set("Content-Length", String(file.size));
  // "attachment" keeps browsers from rendering the file inline on our
  // origin; res.attachment() encodes the name safely.
  res.attachment(file.originalName);

  await pipeline(content, res);
};
```

- A **stream** sends the file in small chunks as it is read, instead of loading the whole file into memory first. `pipeline` connects the file stream to the response and handles errors and cleanup.
- `Content-Disposition: attachment` (set by `res.attachment`) tells the browser to **download** the file instead of showing it. Combined with the `X-Content-Type-Options: nosniff` header that helmet adds (chapter 9), the browser will not try to interpret the bytes as a web page on our domain.
- `res.attachment(name)` encodes the original name safely for the header (special characters, quotes, non-ASCII).

### Why "open before streaming" matters

HTTP sends the **status and headers first**, then the body. Once the first byte of the body is sent, you can no longer change the status to 500.

If the file were missing and the stream failed **after** headers were sent, the client would receive a `200 OK` followed by a broken body. Because `read` opens the file first, a missing file throws **before** anything is sent, and the normal error handler can still answer with a proper error.

For errors that do happen mid-stream (a disk failure halfway), the error middleware has a guard (`src/shared/middlewares/error.middleware.ts`):

```ts
if (res.headersSent) {
  logger.error("Error after response started", {
    requestId,
    error: error.message,
  });
  next(error);
  return;
}
```

Too late for a JSON error body: it logs and lets Express close the connection, so the client sees an incomplete download rather than a corrupt one.

### Who can see a file?

```ts
async findById(auth: AuthContext, id: string): Promise<StoredFile> {
  const file = await this.repository.findById(id);

  if (!file || (file.ownerId !== auth.userId && auth.role !== "admin")) {
    throw HttpError.notFound("File not found", { errorCode: "FILE_NOT_FOUND" });
  }

  return file;
}
```

Owners and admins can access a file. For everyone else the answer is **404**, exactly as if the file did not exist, so nobody can probe which file ids exist. (Chapter 8 explains why the users module uses 403 instead.)

### Upload error responses

Multer reports problems as `MulterError`s, which the error middleware maps:

| Situation                                              | Status | `errorCode`             | Raised by                 |
| ------------------------------------------------------ | ------ | ----------------------- | ------------------------- |
| No `file` field                                        | 400    | `FILE_REQUIRED`         | controller                |
| File larger than `UPLOAD_MAX_BYTES`                    | 413    | `FILE_TOO_LARGE`        | multer → error middleware |
| Other multer limits (too many parts, wrong field name) | 400    | `INVALID_UPLOAD`        | multer → error middleware |
| Content is not an allowed type                         | 415    | `UNSUPPORTED_FILE_TYPE` | service                   |
| Not found / not yours                                  | 404    | `FILE_NOT_FOUND`        | service                   |

## Step by step: an upload

```
client ──multipart──▶ authenticate ──▶ multer (limits, buffer)
                                         │
                                         ▼
                                 idempotency (optional, ch. 11)
                                         │
                                         ▼
                      controller: req.file present? ── no ──▶ 400 FILE_REQUIRED
                                         │ yes
                                         ▼
                  service: detectMimeType ── null ──▶ 415 UNSUPPORTED_FILE_TYPE
                                         │
                       storage.save(uuid) → repository.create → audit
                                         │
                                         ▼
                                201 { id, originalName, mimeType, size, ... }
```

## Try it yourself

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/authentication/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Files Demo","email":"files@example.com","password":"correct horse battery"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).data.accessToken')

# 1. A valid PNG
printf '\x89PNG\r\n\x1a\nhello' > /tmp/demo.png
curl -s -X POST http://localhost:3000/api/v1/files \
  -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/demo.png"
```

```json
{
  "statusCode": 201,
  "message": "File uploaded successfully",
  "data": {
    "id": "58008620-...",
    "ownerId": "12a9b979-...",
    "originalName": "demo.png",
    "mimeType": "image/png",
    "size": 13,
    "createdAt": "..."
  }
}
```

```bash
# 2. A script pretending to be a PNG
printf '#!/bin/sh\necho pwned' > /tmp/fake.png
curl -s -X POST http://localhost:3000/api/v1/files \
  -H "Authorization: Bearer $TOKEN" -F "file=@/tmp/fake.png;type=image/png"
# {"statusCode":415,"message":"Unsupported file type. Allowed: image/png, image/jpeg, image/gif, image/webp, application/pdf","errorCode":"UNSUPPORTED_FILE_TYPE"}

# 3. Download it back (use the id from step 1)
curl -s -D - -o /tmp/downloaded.png \
  http://localhost:3000/api/v1/files/<id>/content -H "Authorization: Bearer $TOKEN" \
  | grep -iE "^HTTP|content-type|content-disposition"
# HTTP/1.1 200 OK
# Content-Type: image/png
# Content-Disposition: attachment; filename="demo.png"
```

Look in the `uploads/` folder: the file is stored under a UUID, not under `demo.png`.

## Common mistakes

- **Trusting the file extension or `Content-Type`.** Detect the type from the content, using an allowlist.
- **Using the client's file name as a path.** Generate names; keep the original only as metadata.
- **No size limits.** One request can exhaust memory or disk.
- **Serving uploads inline from your own domain.** Use `attachment` and `nosniff`, or serve from a separate domain/CDN.
- **Leaving orphans.** If saving metadata fails after saving bytes (or the other way round), clean up.
- **Opening the file after sending headers.** A missing file then becomes a broken `200` response.
- **Keeping files on local disk with several servers.** Each server would only see its own files; use shared storage (S3, GCS) by implementing `FileStorage`.

## Summary

- Files arrive as `multipart/form-data`; multer parses them with strict limits.
- The real type comes from **magic bytes** checked against an allowlist; the name and `Content-Type` are untrusted.
- Bytes are stored under generated UUID keys behind the `FileStorage` interface, with path-traversal checks and no overwrites.
- Downloads are streamed as attachments; missing files fail before headers are sent.
- Non-owners get 404, so file ids cannot be probed.

Next: [14. Audit log and request context](14-audit-log-and-request-context.md).
