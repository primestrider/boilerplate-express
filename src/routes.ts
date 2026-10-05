import { Router } from "express";

import type { AppDependencies } from "./app";
import { createDocsRouter } from "./docs/docs.routes";
import { createAuthenticate } from "./modules/authentication/authenticate.middleware";
import { createAuthenticationModule } from "./modules/authentication/authentication.module";
import { TokenService } from "./modules/authentication/token.service";
import { createHealthModule } from "./modules/health/health.module";
import { createUserModule } from "./modules/users/user.module";

/**
 * Builds every feature module, wires their dependencies, and mounts them
 * under /api.
 *
 * Modules receive only what they declare. A module that needs another
 * module's service gets the instance created here, so each repository and
 * service exists once and the dependency direction is visible in one place.
 */
export const createRoutes = ({ db, config }: AppDependencies) => {
  const tokenService = new TokenService({
    secret: config.JWT_SECRET,
    accessTokenTtlSeconds: config.JWT_TTL_SECONDS,
    refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  });
  const authenticate = createAuthenticate(tokenService);

  const health = createHealthModule({ db });
  const users = createUserModule({ db, authenticate });
  const authentication = createAuthenticationModule({
    db,
    tokenService,
    authenticate,
    userRepository: users.repository,
    userService: users.service,
  });

  const router = Router();

  router.use("/health", health.router);
  router.use("/authentication", authentication.router);
  router.use("/users", users.router);

  // API docs reveal the whole surface, so they are off in production.
  if (config.NODE_ENV !== "production") {
    router.use("/docs", createDocsRouter());
  }

  return router;
};
