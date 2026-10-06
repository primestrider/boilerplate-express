import { and, desc, eq, type SQL } from "drizzle-orm";

import type { DB } from "../../db";
import { auditLogs } from "../../db/schema";
import { offsetOf } from "../../shared/http/pagination";
import type { AuditLog, NewAuditLog } from "./audit.entity";
import type { ListAuditLogsQueryDto } from "./audit.schema";

export interface AuditLogRepository {
  create(entry: NewAuditLog): Promise<void>;
  findAll(
    query: ListAuditLogsQueryDto,
  ): Promise<{ logs: AuditLog[]; total: number }>;
}

export class DrizzleAuditLogRepository implements AuditLogRepository {
  constructor(private readonly db: DB) {}

  async create(entry: NewAuditLog): Promise<void> {
    await this.db.insert(auditLogs).values(entry);
  }

  /**
   * Returns matching entries, newest first.
   */
  async findAll(query: ListAuditLogsQueryDto) {
    const filters: SQL[] = [];

    if (query.actorId) filters.push(eq(auditLogs.actorId, query.actorId));
    if (query.action) filters.push(eq(auditLogs.action, query.action));
    if (query.entityType) {
      filters.push(eq(auditLogs.entityType, query.entityType));
    }
    if (query.entityId) filters.push(eq(auditLogs.entityId, query.entityId));

    const where = and(...filters);

    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(query.limit)
        .offset(offsetOf(query)),
      this.db.$count(auditLogs, where),
    ]);

    // The column only ever receives AuditAction values (see AuditService).
    return { logs: rows as AuditLog[], total };
  }
}
