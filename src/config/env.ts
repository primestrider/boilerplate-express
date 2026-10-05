import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

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
    DATABASE_URL: z.string().min(1).default("dev.db"),
    // HS256 signing key. Generate one with:
    // node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
    JWT_SECRET: z.string().min(32),
    JWT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(30 * 24 * 60 * 60),
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
