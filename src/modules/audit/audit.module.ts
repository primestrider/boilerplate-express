import type { RequestHandler } from "express";

import type { DB } from "../../db";
import { AuditController } from "./audit.controller";
import { DrizzleAuditLogRepository } from "./audit.repository";
import { createAuditRouter } from "./audit.routes";
import { AuditService } from "./audit.service";

type AuditModuleDependencies = {
  db: DB;
  authenticate: RequestHandler;
};

/**
 * Wires the audit module. The service is returned for the modules that record
 * actions; the router exposes the log to admins.
 */
export const createAuditModule = ({
  db,
  authenticate,
}: AuditModuleDependencies) => {
  const service = new AuditService(new DrizzleAuditLogRepository(db));
  const controller = new AuditController(service);

  return { router: createAuditRouter(controller, authenticate), service };
};
