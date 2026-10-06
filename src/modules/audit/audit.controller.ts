import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { sendPaginated } from "../../shared/http/response";
import type { AuditLog } from "./audit.entity";
import type { AuditLogResponse, ListAuditLogsQueryDto } from "./audit.schema";
import type { AuditService } from "./audit.service";

const toAuditLogResponse = (log: AuditLog): AuditLogResponse => ({
  id: log.id,
  actorId: log.actorId,
  action: log.action,
  entityType: log.entityType,
  entityId: log.entityId,
  metadata: log.metadata,
  ip: log.ip,
  requestId: log.requestId,
  createdAt: log.createdAt.toISOString(),
});

export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * GET /audit-logs
   */
  findAll: RequestHandler<
    Record<string, never>,
    unknown,
    unknown,
    ListAuditLogsQueryDto
  > = async (req, res) => {
    const logs = await this.auditService.findAll(req.query);

    sendPaginated(
      res,
      StatusCodes.OK,
      logs.data.map(toAuditLogResponse),
      logs.meta,
      "Audit logs retrieved successfully",
    );
  };
}
