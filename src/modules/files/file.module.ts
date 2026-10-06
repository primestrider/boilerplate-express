import type { RequestHandler } from "express";

import type { DB } from "../../db";
import type { FileStorage } from "../../shared/storage/file-storage";
import type { AuditService } from "../audit/audit.service";
import { FileController } from "./file.controller";
import { DrizzleFileRepository } from "./file.repository";
import { createFileRouter } from "./file.routes";
import { FileService } from "./file.service";

type FileModuleDependencies = {
  db: DB;
  storage: FileStorage;
  authenticate: RequestHandler;
  idempotency: RequestHandler;
  auditService: AuditService;
  maxFileBytes: number;
};

export const createFileModule = ({
  db,
  storage,
  authenticate,
  idempotency,
  auditService,
  maxFileBytes,
}: FileModuleDependencies) => {
  const service = new FileService(
    new DrizzleFileRepository(db),
    storage,
    auditService,
  );
  const controller = new FileController(service);

  return {
    router: createFileRouter(controller, {
      authenticate,
      idempotency,
      maxFileBytes,
    }),
  };
};
