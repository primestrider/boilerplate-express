/**
 * Applies pending migrations from ./drizzle.
 *
 *   npm run db:migrate              (development)
 *   node dist/db/migrate.js         (after build, e.g. in the container)
 *
 * Uses the runtime driver instead of drizzle-kit, so production images do not
 * need dev dependencies.
 */
import { migrate } from "drizzle-orm/mysql2/migrator";

import { env } from "../config/env";
import { logger } from "../config/logger";
import { createDatabase } from ".";

const main = async () => {
  const db = createDatabase(env.DATABASE_URL);

  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    logger.info("Migrations applied");
  } finally {
    await db.$client.end();
  }
};

main().catch((error: unknown) => {
  logger.error("Migration failed", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
