import type { CorsOptions } from "cors";

/**
 * Builds CORS options from a comma-separated origin list ("*" = any).
 */
export const createCorsOptions = (corsOrigin: string): CorsOptions => {
  const allowedOrigins = corsOrigin
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return {
    origin:
      allowedOrigins.includes("*") || allowedOrigins.length === 0
        ? "*"
        : (origin, callback) => {
            // Disallowed origins get no CORS headers, so the browser blocks
            // the response. Requests without an Origin (curl, server-to-server)
            // pass.
            callback(null, !origin || allowedOrigins.includes(origin));
          },
  };
};
