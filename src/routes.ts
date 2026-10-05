import { Router, type RequestHandler } from "express";

import type { AppDependencies } from "./app";
import { env } from "./config/env";
import { createAuthenticate } from "./modules/authentication/authenticate.middleware";
import { createAuthenticationModule } from "./modules/authentication/authentication.module";
import { TokenService } from "./modules/authentication/token.service";
import { createHealthModule } from "./modules/health/health.module";
import { createUserModule } from "./modules/users/user.module";

/**
 * Dependencies shared by feature modules: the app's infrastructure plus
 * cross-cutting pieces built once here (authentication).
 */
export type ModuleDependencies = AppDependencies & {
  tokenService: TokenService;
  authenticate: RequestHandler;
};

/**
 * Mounts every feature module under /api.
 */
export const createRoutes = (deps: AppDependencies) => {
  const tokenService = new TokenService({
    secret: env.JWT_SECRET,
    ttlSeconds: env.JWT_TTL_SECONDS,
  });
  const moduleDeps: ModuleDependencies = {
    ...deps,
    tokenService,
    authenticate: createAuthenticate(tokenService),
  };

  const router = Router();

  router.use("/health", createHealthModule(moduleDeps));
  router.use("/authentication", createAuthenticationModule(moduleDeps));
  router.use("/users", createUserModule(moduleDeps));

  return router;
};
