import type { RequestHandler } from "express";
import type Redis from "ioredis";

import { createAuthenticationLimiter } from "../../config/rate-limit.config";
import type { DB } from "../../db";
import type { JobQueue } from "../../jobs/jobs";
import type { AuditService } from "../audit/audit.service";
import type { UserRepository } from "../users/user.repository";
import type { UserService } from "../users/user.service";
import { AuthenticationController } from "./authentication.controller";
import { createAuthenticationRouter } from "./authentication.routes";
import { AuthenticationService } from "./authentication.service";
import { DrizzleRefreshTokenRepository } from "./refresh-token.repository";
import type { TokenService } from "./token.service";

type AuthenticationModuleDependencies = {
  db: DB;
  redis: Redis | undefined;
  tokenService: TokenService;
  authenticate: RequestHandler;
  userRepository: UserRepository;
  userService: UserService;
  auditService: AuditService;
  jobQueue: JobQueue;
};

/**
 * Wires the authentication module. It builds on the user module's
 * repository and service rather than creating its own.
 */
export const createAuthenticationModule = ({
  db,
  redis,
  tokenService,
  authenticate,
  userRepository,
  userService,
  auditService,
  jobQueue,
}: AuthenticationModuleDependencies) => {
  const authenticationService = new AuthenticationService({
    userService,
    userRepository,
    refreshTokenRepository: new DrizzleRefreshTokenRepository(db),
    tokenService,
    auditService,
    jobQueue,
  });
  const controller = new AuthenticationController(
    authenticationService,
    userService,
  );

  return {
    router: createAuthenticationRouter(
      controller,
      authenticate,
      createAuthenticationLimiter(redis),
    ),
  };
};
