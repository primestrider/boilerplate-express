import type { RequestHandler } from "express";

import type { DB } from "../../db";
import type { Cache } from "../../shared/cache/cache";
import type { AuditService } from "../audit/audit.service";
import { CachedUserRepository } from "./cached-user.repository";
import { UserController } from "./user.controller";
import { DrizzleUserRepository } from "./user.repository";
import { createUserRouter } from "./user.routes";
import { UserService } from "./user.service";

type UserModuleDependencies = {
  db: DB;
  cache: Cache;
  authenticate: RequestHandler;
  auditService: AuditService;
};

/**
 * Wires the user module.
 *
 * The repository and service are returned so other modules (authentication)
 * reuse the same instances instead of building their own, which also keeps
 * every write going through the cache invalidation.
 */
export const createUserModule = ({
  db,
  cache,
  authenticate,
  auditService,
}: UserModuleDependencies) => {
  const repository = new CachedUserRepository(
    new DrizzleUserRepository(db),
    cache,
  );
  const service = new UserService(repository, auditService);
  const controller = new UserController(service);

  return {
    router: createUserRouter(controller, authenticate),
    repository,
    service,
  };
};
