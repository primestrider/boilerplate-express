/**
 * Returns true when a database error was caused by a UNIQUE constraint.
 *
 * Drizzle wraps driver errors in DrizzleQueryError, so the SQLite error code is
 * read from the error itself or from its cause. Add "23505" here when moving
 * to PostgreSQL.
 */
export const isUniqueViolation = (error: unknown): boolean => {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];

  return candidates.some(
    (candidate) =>
      (candidate as { code?: unknown } | null)?.code ===
      "SQLITE_CONSTRAINT_UNIQUE",
  );
};
