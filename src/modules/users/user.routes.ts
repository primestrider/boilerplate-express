import { Router } from "express";

import { asyncHandler } from "../../middlewares/async-handler.middleware";
import { validate } from "../../middlewares/validate.middleware";
import type { UserController } from "./user.controller";
import { createUserSchema, userIdParamsSchema } from "./user.validation";

/**
 * Builds user routes with injected controller dependencies.
 *
 * Keeping route creation in a function makes tests and dependency injection
 * simpler because callers can pass mocked controllers.
 */
export const createUserRouter = (userController: UserController) => {
  const router = Router();

  router.get("/", asyncHandler(userController.findAll));
  router.get(
    "/:id",
    validate({ params: userIdParamsSchema }),
    asyncHandler(userController.findById),
  );
  router.post(
    "/",
    validate({ body: createUserSchema }),
    asyncHandler(userController.create),
  );

  return router;
};
