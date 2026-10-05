import { Router, type RequestHandler } from "express";

import { createAuthenticationLimiter } from "../../config/rate-limit.config";
import { validate } from "../../shared/middlewares/validate.middleware";
import type { AuthenticationController } from "./authentication.controller";
import { loginSchema, registerSchema } from "./authentication.schema";

export const createAuthenticationRouter = (
  authenticationController: AuthenticationController,
  authenticate: RequestHandler,
) => {
  const router = Router();
  // Shared by register and login: both run an expensive password hash.
  const authenticationLimiter = createAuthenticationLimiter();

  router.post(
    "/register",
    authenticationLimiter,
    validate({ body: registerSchema }),
    authenticationController.register,
  );
  router.post(
    "/login",
    authenticationLimiter,
    validate({ body: loginSchema }),
    authenticationController.login,
  );
  router.get("/profile", authenticate, authenticationController.profile);

  return router;
};
