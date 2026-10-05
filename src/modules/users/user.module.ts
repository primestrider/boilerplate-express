import type { RequestHandler } from "express";

import type { DB } from "../../db";
import { UserController } from "./user.controller";
import { DrizzleUserRepository } from "./user.repository";
import { createUserRouter } from "./user.routes";
import { UserService } from "./user.service";

type UserModuleDependencies = {
  db: DB;
  authenticate: RequestHandler;
};

/**
 * Wires the user module.
 *
 * The repository and service are returned so other modules (authentication)
 * reuse the same instances instead of building their own. Replace the
 * repository here if the persistence layer changes.
 */
export const createUserModule = ({
  db,
  authenticate,
}: UserModuleDependencies) => {
  const repository = new DrizzleUserRepository(db);
  const service = new UserService(repository);
  const controller = new UserController(service);

  return {
    router: createUserRouter(controller, authenticate),
    repository,
    service,
  };
};
