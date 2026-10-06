import { and, eq, isNull } from "drizzle-orm";

import type { DB } from "../../db";
import { affectedRows } from "../../db/errors";
import { refreshTokens } from "../../db/schema";

export type StoredRefreshToken = typeof refreshTokens.$inferSelect;

export type CreateRefreshTokenInput = {
  userId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
};

export interface RefreshTokenRepository {
  create(input: CreateRefreshTokenInput): Promise<void>;
  findByHash(tokenHash: string): Promise<StoredRefreshToken | null>;
  /**
   * Revokes one token if it is still active. Returns false when it was
   * already revoked, which keeps "use once" safe under concurrent refreshes.
   */
  revokeIfActive(id: string): Promise<boolean>;
  revokeFamily(familyId: string): Promise<void>;
  /** Ends every session of a user (e.g. after a password change). */
  revokeAllForUser(userId: string): Promise<void>;
}

export class DrizzleRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly db: DB) {}

  async create(input: CreateRefreshTokenInput): Promise<void> {
    await this.db.insert(refreshTokens).values(input);
  }

  async findByHash(tokenHash: string): Promise<StoredRefreshToken | null> {
    const [token] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    return token ?? null;
  }

  async revokeIfActive(id: string): Promise<boolean> {
    // A single conditional UPDATE: of two concurrent calls, only one changes
    // the row.
    const result = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)));

    return affectedRows(result) > 0;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, familyId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)),
      );
  }
}
