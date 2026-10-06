import { Router, type RequestHandler } from "express";

import { validate } from "../../shared/middlewares/validate.middleware";
import { requireRole } from "../authentication/authorize";
import type { AuditController } from "./audit.controller";
import { listAuditLogsQuerySchema } from "./audit.schema";

/**
 * The audit log is visible to admins only.
 */
export const createAuditRouter = (
  auditController: AuditController,
  authenticate: RequestHandler,
) => {
  const router = Router();

  router.use(authenticate, requireRole("admin"));

  router.get(
    "/",
    validate({ query: listAuditLogsQuerySchema }),
    auditController.findAll,
  );

  return router;
};
