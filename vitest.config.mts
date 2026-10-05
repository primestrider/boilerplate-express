import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      NODE_ENV: "test",
      CORS_ORIGIN: "*",
      TRUST_PROXY: "0",
      RATE_LIMIT_MAX: "1000",
      DATABASE_URL: ":memory:",
      JWT_SECRET: "test-secret-that-is-at-least-32-characters-long",
      JWT_TTL_SECONDS: "900",
      REFRESH_TOKEN_TTL_SECONDS: "2592000",
    },
  },
});
