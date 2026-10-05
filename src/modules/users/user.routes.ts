import { Router, type RequestHandler } from "express";

import { validate } from "../../shared/middlewares/validate.middleware";
import type { UserController } from "./user.controller";
import { listUsersQuerySchema, userIdParamsSchema } from "./user.schema";

/**
 * Builds user routes with injected controller dependencies.
 *
 * All routes require a valid access token. Users are created through
 * POST /authentication/register. Express 5 forwards rejected promises from async
 * handlers to the error middleware, so no async wrapper is needed.
 */
export const createUserRouter = (
  userController: UserController,
  authenticate: RequestHandler,
) => {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/",
    validate({ query: listUsersQuerySchema }),
    userController.findAll,
  );
  router.get(
    "/:id",
    validate({ params: userIdParamsSchema }),
    userController.findById,
  );

  return router;
};
