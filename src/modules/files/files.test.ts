import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";

import type { DB } from "../../db";
import {
  createTestApp,
  registerAdmin,
  registerUser,
  type TestApp,
} from "../../test/create-test-app";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("rest of the image"),
]);

describe("files", () => {
  let app: TestApp;
  let db: DB;
  let token: string;

  beforeEach(async () => {
    ({ app, db } = await createTestApp({ UPLOAD_MAX_BYTES: 1024 }));
    token = (await registerUser(app)).accessToken;
  });

  const upload = (
    data: Buffer,
    name = "photo.png",
    headers: Record<string, string> = {},
  ) =>
    request(app)
      .post("/api/v1/files")
      .set("Authorization", `Bearer ${token}`)
      .set(headers)
      .attach("file", data, name);

  const get = (url: string, as = token) =>
    request(app).get(url).set("Authorization", `Bearer ${as}`);

  it("uploads, lists, downloads and deletes a file", async () => {
    const created = await upload(PNG, "foto-ü.png");

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      originalName: "foto-ü.png",
      mimeType: "image/png",
      size: PNG.length,
    });
    const { id } = created.body.data;

    const list = await get("/api/v1/files");
    expect(list.body.data.map((f: { id: string }) => f.id)).toEqual([id]);

    const download = await get(`/api/v1/files/${id}/content`).buffer(true);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("image/png");
    expect(download.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(Buffer.compare(download.body, PNG)).toBe(0);

    const removed = await request(app)
      .delete(`/api/v1/files/${id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect((await get(`/api/v1/files/${id}`)).status).toBe(404);
  });

  it("detects the type from the content, not the name", async () => {
    const res = await upload(Buffer.from("#!/bin/sh\necho pwned"), "photo.png");

    expect(res.status).toBe(415);
    expect(res.body.errorCode).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects files over UPLOAD_MAX_BYTES", async () => {
    const res = await upload(Buffer.concat([PNG, Buffer.alloc(2048)]));

    expect(res.status).toBe(413);
    expect(res.body.errorCode).toBe("FILE_TOO_LARGE");
  });

  it("requires the file field", async () => {
    const res = await request(app)
      .post("/api/v1/files")
      .set("Authorization", `Bearer ${token}`)
      .field("note", "no file");

    expect(res.status).toBe(400);
    expect(res.body.errorCode).toBe("FILE_REQUIRED");
  });

  it("hides other users' files, but not from admins", async () => {
    const { id } = (await upload(PNG)).body.data;
    const other = await registerUser(app, { email: "other@x.com" });
    const admin = await registerAdmin(app, db);

    const asOther = await get(`/api/v1/files/${id}`, other.accessToken);
    const asAdmin = await get(`/api/v1/files/${id}`, admin.accessToken);

    expect(asOther.status).toBe(404);
    expect(asOther.body.errorCode).toBe("FILE_NOT_FOUND");
    expect(asAdmin.status).toBe(200);
  });

  describe("Idempotency-Key", () => {
    it("replays the first response instead of uploading twice", async () => {
      const first = await upload(PNG, "a.png", { "Idempotency-Key": "k1" });
      const retry = await upload(PNG, "a.png", { "Idempotency-Key": "k1" });

      expect(retry.status).toBe(201);
      expect(retry.headers["idempotent-replayed"]).toBe("true");
      expect(retry.body).toEqual(first.body);
      expect((await get("/api/v1/files")).body.meta.total).toBe(1);
    });

    it("rejects the same key for a different request", async () => {
      await upload(PNG, "a.png", { "Idempotency-Key": "k1" });

      const res = await upload(
        Buffer.concat([PNG, Buffer.from("x")]),
        "a.png",
        { "Idempotency-Key": "k1" },
      );

      expect(res.status).toBe(422);
      expect(res.body.errorCode).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("scopes keys per user", async () => {
      await upload(PNG, "a.png", { "Idempotency-Key": "k1" });
      token = (await registerUser(app, { email: "other@x.com" })).accessToken;

      const res = await upload(PNG, "a.png", { "Idempotency-Key": "k1" });

      expect(res.status).toBe(201);
      expect(res.headers["idempotent-replayed"]).toBeUndefined();
    });

    it("replays client errors, since the same request fails the same way", async () => {
      const notAnImage = Buffer.from("not an image");
      const failed = await upload(notAnImage, "a.png", {
        "Idempotency-Key": "k2",
      });
      const again = await upload(notAnImage, "a.png", {
        "Idempotency-Key": "k2",
      });

      expect(failed.status).toBe(415);
      expect(again.status).toBe(415);
      expect(again.headers["idempotent-replayed"]).toBe("true");
    });

    it("rejects malformed keys", async () => {
      const res = await upload(PNG, "a.png", { "Idempotency-Key": "bad key!" });

      expect(res.status).toBe(400);
      expect(res.body.errorCode).toBe("INVALID_IDEMPOTENCY_KEY");
    });
  });
});
