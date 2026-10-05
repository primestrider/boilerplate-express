# boilerplate-express

Boilerplate REST API dengan **Express 4 + TypeScript + Prisma (SQLite)**, memakai arsitektur modular berlapis (routes → controller → service → repository) dengan dependency injection manual.

## Fitur

- **TypeScript strict** (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- **Validasi env** saat startup dengan Zod (`src/config/env.ts`) — aplikasi gagal start jika env tidak valid
- **Validasi request** (body / params / query) dengan Zod lewat middleware `validate`
- **Format response seragam** via `responseFormatter` + `HttpError` (`src/libs/response.ts`)
- **Error handler terpusat** — menangani `ZodError`, `HttpError`, error Prisma (P2002 → 409), dan error tak terduga (stack trace hanya tampil di non-production)
- **Keamanan**: `helmet`, CORS dengan allowlist, rate limit global, `trust proxy` yang bisa dikonfigurasi
- **Logging** JSON dengan Winston + request logger (method, path, status, durasi)
- **Graceful shutdown** (SIGINT/SIGTERM) yang menutup server dan koneksi Prisma

## Prasyarat

- Node.js 20+ (diuji di Node 24)
- npm

## Memulai

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate    # membuat database SQLite + migration awal
npm run dev               # http://localhost:3000
```

## Environment Variables

| Variable       | Default         | Keterangan                                                                 |
| -------------- | --------------- | -------------------------------------------------------------------------- |
| `NODE_ENV`     | `development`   | `development` \| `test` \| `production`                                    |
| `PORT`         | `3000`          | Port HTTP                                                                  |
| `CORS_ORIGIN`  | `*`             | Daftar origin dipisah koma, mis. `https://a.com,https://b.com`. `*` = semua |
| `TRUST_PROXY`  | `1`             | Jumlah hop proxy yang dipercaya (`0` jika tidak di belakang proxy)         |
| `DATABASE_URL` | `file:./dev.db` | Connection string Prisma (path relatif terhadap `prisma/`)                 |

## Scripts

| Script                    | Fungsi                                       |
| ------------------------- | -------------------------------------------- |
| `npm run dev`             | Jalankan dev server dengan auto-reload (tsx) |
| `npm run build`           | Compile TypeScript ke `dist/`                |
| `npm start`               | Jalankan hasil build (`dist/server.js`)      |
| `npm test`                | Jalankan Jest                                |
| `npm run prisma:generate` | Generate Prisma Client                       |
| `npm run prisma:migrate`  | Buat & jalankan migration (dev)              |
| `npm run prisma:studio`   | Buka Prisma Studio                           |

## Struktur Folder

```
prisma/
  schema.prisma              # skema database
src/
  server.ts                  # entry point: listen, graceful shutdown
  app.ts                     # setup express + middleware global
  routes.ts                  # registrasi semua module di bawah /api
  config/                    # env, logger, cors, rate limit
  libs/
    prisma.ts                # instance PrismaClient bersama
    response.ts              # responseFormatter + HttpError
  middlewares/               # async handler, validate, error, 404, request logger
  modules/
    health/                  # contoh module tanpa database
    users/                   # contoh module CRUD dengan Prisma
```

### Anatomi sebuah module

Setiap module ada di `src/modules/<nama>/` dan terdiri dari:

| File                 | Tanggung jawab                                                                 |
| -------------------- | ------------------------------------------------------------------------------ |
| `*.validation.ts`    | Skema Zod + tipe DTO hasil `z.infer`                                           |
| `*.routes.ts`        | Definisi route, memasang `validate(...)` dan `asyncHandler(...)`              |
| `*.controller.ts`    | Urusan HTTP saja: baca request, panggil service, kirim response               |
| `*.service.ts`       | Business rule; melempar `HttpError` untuk kasus domain (not found, conflict)  |
| `*.repository.ts`    | Interface repository + implementasi Prisma (satu-satunya yang menyentuh DB)   |
| `*.entity.ts`        | Tipe data internal                                                             |
| `*.mapper.ts`        | Entity → DTO response (tempat menyaring field sensitif)                        |
| `*.module.ts`        | Factory yang merangkai repository → service → controller → router             |

### Menambah module baru

1. Tambahkan model di `prisma/schema.prisma`, lalu `npm run prisma:migrate`.
2. Buat folder `src/modules/<nama>/` mengikuti pola module `users`.
3. Daftarkan router di `src/routes.ts`:

   ```ts
   const productModule = createProductModule();
   routes.use("/products", productModule.router);
   ```

## API

Base URL: `/api`

| Method | Endpoint      | Keterangan                                           |
| ------ | ------------- | ---------------------------------------------------- |
| GET    | `/health`     | Status service, uptime, timestamp                    |
| GET    | `/users`      | Daftar user (query: `page` ≥ 1, `limit` 1–100)       |
| GET    | `/users/:id`  | Detail user (`id` harus UUID)                        |
| POST   | `/users`      | Buat user (body: `name` 2–100 karakter, `email`)     |

### Format response

Status sukses/gagal ditentukan oleh **HTTP status code**, sehingga body tidak memiliki field `success`.

Sukses:

```json
{ "message": "User created successfully", "data": { "id": "...", "name": "Ricky", "email": "r@x.com" } }
```

Paginated:

```json
{
  "message": "Users retrieved successfully",
  "data": [],
  "meta": { "page": 1, "limit": 10, "total": 0, "totalPages": 0 }
}
```

Error:

```json
{
  "message": "Validation error",
  "errorCode": "VALIDATION_ERROR",
  "details": [{ "path": "email", "message": "Invalid email address" }]
}
```

Kode error yang dipakai: `VALIDATION_ERROR`, `USER_NOT_FOUND`, `EMAIL_ALREADY_EXISTS`, `RESOURCE_ALREADY_EXISTS`, `DATABASE_ERROR`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`.

## Catatan Keamanan Dependency

- `deepmerge-ts` di-override ke `^8` (lihat `overrides` di `package.json`) karena Prisma 6 masih membawa versi 7 yang rentan (GHSA-ggr8-5vv4-36mx). Override ini bisa dihapus setelah Prisma merilis versi stabil yang memakai `deepmerge-ts` ≥ 8.
- Cek ulang secara berkala dengan `npm audit`.
