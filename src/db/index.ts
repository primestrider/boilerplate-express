import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

/**
 * Opens the SQLite database and wraps it with Drizzle.
 *
 * Called once by the composition root (server.ts) and by tests, which pass
 * ":memory:" to get an isolated database. The raw driver is available as
 * `db.$client` for closing the connection.
 */
export const createDatabase = (url: string) => {
  const sqlite = new Database(url);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle({ client: sqlite, schema });
};

export type DB = ReturnType<typeof createDatabase>;
