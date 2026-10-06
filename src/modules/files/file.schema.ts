import { z } from "zod";

import { paginationQuerySchema } from "../../shared/http/pagination";

export const listFilesQuerySchema = paginationQuerySchema;

export const fileIdParamsSchema = z.object({
  id: z.uuid(),
});

export const fileResponseSchema = z.object({
  id: z.uuid(),
  ownerId: z.uuid(),
  originalName: z.string(),
  mimeType: z.string(),
  size: z.int().describe("Size in bytes"),
  createdAt: z.iso.datetime(),
});

export type ListFilesQueryDto = z.infer<typeof listFilesQuerySchema>;
export type FileIdParamsDto = z.infer<typeof fileIdParamsSchema>;
export type FileResponse = z.infer<typeof fileResponseSchema>;
