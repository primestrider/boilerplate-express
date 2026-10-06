import { z } from "zod";

import type { PaginationMeta } from "./response";

/**
 * `page` and `limit` query parameters shared by list endpoints. Extend it
 * with filters: `paginationQuerySchema.extend({ ... })`.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type Paginated<T> = {
  data: T[];
  meta: PaginationMeta;
};

/** Rows to skip for a page. */
export const offsetOf = ({ page, limit }: PaginationQuery) =>
  (page - 1) * limit;

export const paginate = <T>(
  data: T[],
  total: number,
  { page, limit }: PaginationQuery,
): Paginated<T> => ({
  data,
  meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
});
