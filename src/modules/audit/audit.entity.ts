import type { auditLogs } from "../../db/schema";

/**
 * Every action the audit log records. Add new ones here; the list endpoint
 * validates its `action` filter against this list.
 */
export const AUDIT_ACTIONS = [
  "auth.registered",
  "auth.login",
  "auth.login_failed",
  "auth.password_changed",
  "auth.refresh_token_reused",
  "user.updated",
  "user.role_changed",
  "user.deleted",
  "file.uploaded",
  "file.deleted",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditLog = Omit<typeof auditLogs.$inferSelect, "action"> & {
  action: AuditAction;
};

/**
 * What a caller records. Actor, IP and request id default to the current
 * request (see request-context.ts).
 */
export type AuditEntry = {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** Who acted. Defaults to the authenticated caller. */
  actorId?: string | null;
  /** Never put secrets (passwords, tokens) here. */
  metadata?: Record<string, unknown>;
};

export type NewAuditLog = Omit<AuditLog, "id" | "createdAt">;
