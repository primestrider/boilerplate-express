import argon2 from "argon2";

/**
 * Argon2id with an OWASP-recommended configuration (19 MiB, 2 iterations,
 * 1 lane). Memory is the main cost, so keep login rate-limited: every
 * concurrent hash holds this much RAM.
 *
 * Raising these values later is safe: existing hashes keep verifying, and
 * `needsRehash` tells the login flow to upgrade them.
 */
const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19 * 1024, // KiB
  timeCost: 2,
  parallelism: 1,
} as const;

export const hashPassword = (password: string) =>
  argon2.hash(password, HASH_OPTIONS);

export const verifyPassword = (hash: string, password: string) =>
  argon2.verify(hash, password);

export const needsRehash = (hash: string) =>
  argon2.needsRehash(hash, HASH_OPTIONS);
