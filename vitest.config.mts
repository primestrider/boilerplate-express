import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests run against MySQL: start it with
    // `docker compose up -d mysql` (CI uses a service container). Each worker
    // creates its own database, named after DATABASE_URL plus a suffix.
    env: {
      NODE_ENV: "test",
      CORS_ORIGIN: "*",
      TRUST_PROXY: "0",
      RATE_LIMIT_MAX: "1000",
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        "mysql://root:root@127.0.0.1:3306/app_test",
      JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
      JWT_TTL_SECONDS: "900",
      REFRESH_TOKEN_TTL_SECONDS: "2592000",
    },
    hookTimeout: 30_000,
  },
});
