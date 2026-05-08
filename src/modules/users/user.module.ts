import { prisma } from "../../libs/prisma";
import { UserController } from "./user.controller";
import { PrismaUserRepository } from "./user.repository";
import { createUserRouter } from "./user.routes";
import { UserService } from "./user.service";

/**
 * Creates the user module with all of its dependencies.
 *
 * Replace the repository here if the persistence layer changes.
 */
export const createUserModule = () => {
  const repository = new PrismaUserRepository(prisma);
  const service = new UserService(repository);
  const controller = new UserController(service);
  const router = createUserRouter(controller);

  return {
    controller,
    repository,
    router,
    service,
  };
};
