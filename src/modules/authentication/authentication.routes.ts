import { Router, type RequestHandler } from "express";

import { validate } from "../../shared/middlewares/validate.middleware";
import type { AuthenticationController } from "./authentication.controller";
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
} from "./authentication.schema";

export const createAuthenticationRouter = (
  authenticationController: AuthenticationController,
  authenticate: RequestHandler,
  credentialsLimiter: RequestHandler,
) => {
  const router = Router();

  // Credential endpoints share a stricter limiter (only failures count).
  router.post(
    "/register",
    credentialsLimiter,
    validate({ body: registerSchema }),
    authenticationController.register,
  );
  router.post(
    "/login",
    credentialsLimiter,
    validate({ body: loginSchema }),
    authenticationController.login,
  );
  router.post(
    "/refresh",
    credentialsLimiter,
    validate({ body: refreshSchema }),
    authenticationController.refresh,
  );
  router.post(
    "/logout",
    validate({ body: refreshSchema }),
    authenticationController.logout,
  );
  router.post(
    "/change-password",
    authenticate,
    credentialsLimiter,
    validate({ body: changePasswordSchema }),
    authenticationController.changePassword,
  );
  router.get("/profile", authenticate, authenticationController.profile);

  return router;
};
