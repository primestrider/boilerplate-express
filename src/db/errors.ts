/**
 * Returns true when a database error was caused by a UNIQUE constraint.
 *
 * Drizzle wraps driver errors in DrizzleQueryError, so the MySQL error code is
 * read from the error itself or from its cause.
 */
export const isUniqueViolation = (error: unknown): boolean => {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];

  return candidates.some(
    (candidate) =>
      (candidate as { code?: unknown } | null)?.code === "ER_DUP_ENTRY",
  );
};

/** Rows changed by an UPDATE/DELETE, read from mysql2's result header. */
export const affectedRows = (result: [{ affectedRows: number }, unknown]) =>
  result[0].affectedRows;
