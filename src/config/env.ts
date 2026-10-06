import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

/** An optional variable; an empty value (`SMTP_HOST=`) counts as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

const envSchema = z
  .object({
    // Required on purpose: defaulting to "development" would leak error
    // details on a production server that forgot to set NODE_ENV.
    NODE_ENV: z.enum(["development", "test", "production"]),
    PORT: z.coerce.number().int().positive().default(3000),
    CORS_ORIGIN: z.string().default("*"),
    // 0 = not behind a proxy. Trusting hops that do not exist lets clients
    // spoof X-Forwarded-For and bypass IP-based rate limiting.
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
    // mysql://user:password@host:3306/database
    DATABASE_URL: z.url({ protocol: /^mysql$/ }),
    // Optional. Without it the cache, rate limiter and idempotency store live
    // in process memory and background jobs run inline: fine for a single
    // instance, wrong for several.
    REDIS_URL: optional(z.url({ protocol: /^rediss?$/ })),
    // HS256 signing key. Generate one with:
    // node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
    JWT_SECRET: z.string().min(32),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 24 * 60 * 60),
    // Without SMTP_HOST emails are written to the log instead of being sent.
    SMTP_HOST: optional(z.string()),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    SMTP_USER: optional(z.string()),
    SMTP_PASS: optional(z.string()),
    MAIL_FROM: z.string().min(1).default("Boilerplate <no-reply@example.com>"),
    // Uploaded files are stored here (relative to the working directory).
    UPLOAD_DIR: z.string().min(1).default("uploads"),
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 1024 * 1024),
  })
  .refine(
    (env) =>
      env.NODE_ENV !== "production" ||
      (env.CORS_ORIGIN.trim() !== "" &&
        !env.CORS_ORIGIN.split(",").some((origin) => origin.trim() === "*")),
    {
      path: ["CORS_ORIGIN"],
      message: "CORS_ORIGIN must list explicit origins in production",
    },
  );

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  throw new Error(
    `Invalid environment variables: ${JSON.stringify(
      parsedEnv.error.flatten().fieldErrors,
    )}`,
  );
}

export type Env = z.infer<typeof envSchema>;

export const env: Env = parsedEnv.data;
