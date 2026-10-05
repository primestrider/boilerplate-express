import type { RequestHandler } from "express";

import { createAuthenticationLimiter } from "../../config/rate-limit.config";
import type { DB } from "../../db";
import type { UserRepository } from "../users/user.repository";
import type { UserService } from "../users/user.service";
import { AuthenticationController } from "./authentication.controller";
import { createAuthenticationRouter } from "./authentication.routes";
import { AuthenticationService } from "./authentication.service";
import { DrizzleRefreshTokenRepository } from "./refresh-token.repository";
import type { TokenService } from "./token.service";

type AuthenticationModuleDependencies = {
  db: DB;
  tokenService: TokenService;
  authenticate: RequestHandler;
  userRepository: UserRepository;
  userService: UserService;
};

/**
 * Wires the authentication module. It builds on the user module's
 * repository and service rather than creating its own.
 */
export const createAuthenticationModule = ({
  db,
  tokenService,
  authenticate,
  userRepository,
  userService,
}: AuthenticationModuleDependencies) => {
  const authenticationService = new AuthenticationService(
    userService,
    userRepository,
    new DrizzleRefreshTokenRepository(db),
    tokenService,
  );
  const controller = new AuthenticationController(
    authenticationService,
    userService,
  );

  return {
    router: createAuthenticationRouter(
      controller,
      authenticate,
      createAuthenticationLimiter(),
    ),
  };
};
