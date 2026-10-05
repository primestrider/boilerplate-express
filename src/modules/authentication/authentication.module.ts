import type { ModuleDependencies } from "../../routes";
import { DrizzleUserRepository } from "../users/user.repository";
import { UserService } from "../users/user.service";
import { AuthenticationController } from "./authentication.controller";
import { createAuthenticationRouter } from "./authentication.routes";
import { AuthenticationService } from "./authentication.service";

/**
 * Wires the auth module and returns its router.
 */
export const createAuthenticationModule = ({
  db,
  tokenService,
  authenticate,
}: ModuleDependencies) => {
  const userRepository = new DrizzleUserRepository(db);
  const userService = new UserService(userRepository);
  const authenticationService = new AuthenticationService(
    userService,
    userRepository,
    tokenService,
  );
  const controller = new AuthenticationController(
    authenticationService,
    userService,
  );

  return createAuthenticationRouter(controller, authenticate);
};
