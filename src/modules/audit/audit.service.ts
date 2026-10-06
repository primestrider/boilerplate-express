import { getRequestContext } from "../../shared/context/request-context";
import { paginate, type Paginated } from "../../shared/http/pagination";
import type { AuditEntry, AuditLog } from "./audit.entity";
import type { AuditLogRepository } from "./audit.repository";
import type { ListAuditLogsQueryDto } from "./audit.schema";

/**
 * Records security-relevant actions. Services call `record` right after the
 * action succeeded; the actor, IP and request id come from the current
 * request unless the entry overrides them.
 */
export class AuditService {
  constructor(private readonly repository: AuditLogRepository) {}

  async record(entry: AuditEntry): Promise<void> {
    const context = getRequestContext();

    await this.repository.create({
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      actorId:
        entry.actorId === undefined ? (context?.userId ?? null) : entry.actorId,
      metadata: entry.metadata ?? null,
      ip: context?.ip ?? null,
      requestId: context?.requestId ?? null,
    });
  }

  async findAll(query: ListAuditLogsQueryDto): Promise<Paginated<AuditLog>> {
    const { logs, total } = await this.repository.findAll(query);
    return paginate(logs, total, query);
  }
}
