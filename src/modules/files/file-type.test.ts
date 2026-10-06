import { describe, expect, it } from "vitest";

import { detectMimeType } from "./file-type";

const bytes = (...values: (number | string)[]) =>
  Buffer.concat(
    values.map((v) =>
      typeof v === "string" ? Buffer.from(v) : Buffer.from([v]),
    ),
  );

describe("detectMimeType", () => {
  it.each([
    ["image/png", bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, "data")],
    ["image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)],
    ["image/gif", bytes("GIF89a")],
    ["image/webp", bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")],
    ["application/pdf", bytes("%PDF-1.7")],
  ])("recognizes %s", (mimeType, data) => {
    expect(detectMimeType(data)).toBe(mimeType);
  });

  it.each([
    ["text", bytes("<script>alert(1)</script>")],
    ["RIFF that is not WebP", bytes("RIFF", 0, 0, 0, 0, "WAVE")],
    ["a truncated PNG", bytes(0x89, "PN")],
    ["an empty file", Buffer.alloc(0)],
  ])("rejects %s", (_name, data) => {
    expect(detectMimeType(data)).toBeNull();
  });
});
