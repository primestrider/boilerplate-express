import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import * as schema from "./schema";

/**
 * Opens a MySQL connection pool and wraps it with Drizzle.
 *
 * Called once by the composition root (server.ts, worker.ts) and by tests.
 * The pool is available as `db.$client` for closing it on shutdown.
 */
export const createDatabase = (url: string) => {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 10,
    // Store and read DATETIME values as UTC, whatever the server time zone.
    timezone: "Z",
  });

  return drizzle({ client: pool, schema, mode: "default" });
};

export type DB = ReturnType<typeof createDatabase>;

/**
 * A database handle or an open transaction. Repositories accept either, so a
 * service can run several writes atomically.
 */
export type Executor = DB | Parameters<Parameters<DB["transaction"]>[0]>[0];
