import { z } from "zod";

import { paginationQuerySchema } from "../../shared/http/pagination";
import { AUDIT_ACTIONS } from "./audit.entity";

export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  actorId: z.uuid().optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(36).optional(),
});

export type ListAuditLogsQueryDto = z.infer<typeof listAuditLogsQuerySchema>;

export const auditLogResponseSchema = z.object({
  id: z.uuid(),
  actorId: z.uuid().nullable(),
  action: z.enum(AUDIT_ACTIONS),
  entityType: z.string(),
  entityId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;
