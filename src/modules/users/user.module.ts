import type { ModuleDependencies } from "../../routes";
import { UserController } from "./user.controller";
import { DrizzleUserRepository } from "./user.repository";
import { createUserRouter } from "./user.routes";
import { UserService } from "./user.service";

/**
 * Wires the user module and returns its router.
 *
 * Replace the repository here if the persistence layer changes.
 */
export const createUserModule = ({ db, authenticate }: ModuleDependencies) => {
  const repository = new DrizzleUserRepository(db);
  const service = new UserService(repository);
  const controller = new UserController(service);

  return createUserRouter(controller, authenticate);
};
