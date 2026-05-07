import { UserController } from "./user.controller";
import { InMemoryUserRepository } from "./user.repository";
import { createUserRouter } from "./user.routes";
import { UserService } from "./user.service";

/**
 * Creates the user module with all of its dependencies.
 *
 * Replace the repository here when moving from the in-memory example to a real
 * persistence layer such as Prisma.
 */
export const createUserModule = () => {
  const repository = new InMemoryUserRepository();
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
