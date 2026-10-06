import { Router } from "express";

import type { AppDependencies } from "./app";
import { createDocsRouter } from "./docs/docs.routes";
import { createAuditModule } from "./modules/audit/audit.module";
import { createAuthenticate } from "./modules/authentication/authenticate.middleware";
import { createAuthenticationModule } from "./modules/authentication/authentication.module";
import { TokenService } from "./modules/authentication/token.service";
import { createFileModule } from "./modules/files/file.module";
import { createHealthModule } from "./modules/health/health.module";
import { createUserModule } from "./modules/users/user.module";
import { createIdempotency } from "./shared/middlewares/idempotency.middleware";

/** Current API version; a breaking change gets /v2 next to it. */
export const API_VERSION_PREFIX = "/v1";

/**
 * Builds every feature module, wires their dependencies, and mounts them
 * under /api.
 *
 * Feature routes are versioned (/api/v1/...); health checks and docs are not,
 * since load balancers and tooling should not change with API versions.
 *
 * Modules receive only what they declare. A module that needs another
 * module's service gets the instance created here, so each repository and
 * service exists once and the dependency direction is visible in one place.
 */
export const createRoutes = ({
  db,
  config,
  redis,
  cache,
  jobQueue,
  storage,
}: AppDependencies) => {
  const tokenService = new TokenService({
    secret: config.JWT_SECRET,
    accessTokenTtlSeconds: config.JWT_TTL_SECONDS,
    refreshTokenTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
  });
  const authenticate = createAuthenticate(tokenService);
  const idempotency = createIdempotency(cache);

  const health = createHealthModule({ db, redis });
  const audit = createAuditModule({ db, authenticate });
  const users = createUserModule({
    db,
    cache,
    authenticate,
    auditService: audit.service,
  });
  const authentication = createAuthenticationModule({
    db,
    redis,
    tokenService,
    authenticate,
    userRepository: users.repository,
    userService: users.service,
    auditService: audit.service,
    jobQueue,
  });
  const files = createFileModule({
    db,
    storage,
    authenticate,
    idempotency,
    auditService: audit.service,
    maxFileBytes: config.UPLOAD_MAX_BYTES,
  });

  const v1 = Router();
  v1.use("/authentication", authentication.router);
  v1.use("/users", users.router);
  v1.use("/files", files.router);
  v1.use("/audit-logs", audit.router);

  const router = Router();
  router.use("/health", health.router);
  router.use(API_VERSION_PREFIX, v1);

  // API docs reveal the whole surface, so they are off in production.
  if (config.NODE_ENV !== "production") {
    router.use("/docs", createDocsRouter());
  }

  return router;
};
