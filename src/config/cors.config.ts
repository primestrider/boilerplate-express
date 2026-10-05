import type { CorsOptions } from "cors";

import { env } from "./env";

const allowedOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export const corsOptions: CorsOptions = {
  origin:
    allowedOrigins.includes("*") || allowedOrigins.length === 0
      ? "*"
      : (origin, callback) => {
          // Disallowed origins get no CORS headers, so the browser blocks the
          // response. Requests without an Origin (curl, server-to-server) pass.
          callback(null, !origin || allowedOrigins.includes(origin));
        },
};
