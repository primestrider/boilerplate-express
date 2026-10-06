import { desc, eq } from "drizzle-orm";

import type { DB } from "../../db";
import { files } from "../../db/schema";
import { offsetOf, type PaginationQuery } from "../../shared/http/pagination";

export type StoredFile = typeof files.$inferSelect;

export type CreateFileInput = Omit<StoredFile, "id" | "createdAt">;

export interface FileRepository {
  create(input: CreateFileInput): Promise<StoredFile>;
  findById(id: string): Promise<StoredFile | null>;
  findByOwner(
    ownerId: string,
    query: PaginationQuery,
  ): Promise<{ files: StoredFile[]; total: number }>;
  delete(id: string): Promise<void>;
}

export class DrizzleFileRepository implements FileRepository {
  constructor(private readonly db: DB) {}

  async create(input: CreateFileInput): Promise<StoredFile> {
    const [inserted] = await this.db.insert(files).values(input).$returningId();
    const file = inserted && (await this.findById(inserted.id));

    if (!file) {
      throw new Error("Failed to create file");
    }

    return file;
  }

  async findById(id: string): Promise<StoredFile | null> {
    const [file] = await this.db
      .select()
      .from(files)
      .where(eq(files.id, id))
      .limit(1);

    return file ?? null;
  }

  /**
   * Returns a page of the owner's files, newest first.
   */
  async findByOwner(ownerId: string, query: PaginationQuery) {
    const where = eq(files.ownerId, ownerId);

    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(files)
        .where(where)
        .orderBy(desc(files.createdAt), desc(files.id))
        .limit(query.limit)
        .offset(offsetOf(query)),
      this.db.$count(files, where),
    ]);

    return { files: rows, total };
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(files).where(eq(files.id, id));
  }
}
