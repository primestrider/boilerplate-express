import { Router, type RequestHandler } from "express";

import { requireRole } from "../authentication/authorize";
import { validate } from "../../shared/middlewares/validate.middleware";
import type { UserController } from "./user.controller";
import { listUsersQuerySchema, userIdParamsSchema } from "./user.schema";

/**
 * Builds user routes with injected controller dependencies.
 *
 * All routes require a valid access token; listing users is admin-only and a
 * single user is visible to its owner or an admin (checked in the
 * controller). Users are created through POST /authentication/register.
 */
export const createUserRouter = (
  userController: UserController,
  authenticate: RequestHandler,
) => {
  const router = Router();

  router.use(authenticate);

  router.get(
    "/",
    requireRole("admin"),
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
