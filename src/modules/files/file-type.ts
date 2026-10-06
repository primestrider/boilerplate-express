type Signature = {
  mimeType: string;
  /** Every [offset, bytes] pair must match. */
  parts: [offset: number, bytes: number[]][];
};

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

/**
 * File types accepted for upload, recognized by their leading bytes ("magic
 * numbers"). The client's Content-Type and file name are never trusted: a
 * script renamed to photo.png is still rejected.
 */
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

const matches = (data: Buffer, [offset, bytes]: [number, number[]]) =>
  data.length >= offset + bytes.length &&
  bytes.every((byte, index) => data[offset + index] === byte);

/** Returns the detected MIME type, or null when the type is not allowed. */
export const detectMimeType = (data: Buffer): string | null =>
  SIGNATURES.find(({ parts }) => parts.every((part) => matches(data, part)))
    ?.mimeType ?? null;

export const ALLOWED_MIME_TYPES = SIGNATURES.map(({ mimeType }) => mimeType);
