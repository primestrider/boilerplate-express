import { Router, type RequestHandler } from "express";

import { requireRole } from "../authentication/authorize";
import { validate } from "../../shared/middlewares/validate.middleware";
import type { UserController } from "./user.controller";
import {
  listUsersQuerySchema,
  updateUserRoleSchema,
  updateUserSchema,
  userIdParamsSchema,
} from "./user.schema";

/**
 * Builds user routes with injected controller dependencies.
 *
 * All routes require a valid access token. Listing users and changing roles
 * is admin-only; reading, updating and deleting a user is allowed to its
 * owner or an admin (checked in the controller). Users are created through
 * POST /authentication/register; passwords change through
 * POST /authentication/change-password.
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
  router.patch(
    "/:id",
    validate({ params: userIdParamsSchema, body: updateUserSchema }),
    userController.update,
  );
  router.patch(
    "/:id/role",
    requireRole("admin"),
    validate({ params: userIdParamsSchema, body: updateUserRoleSchema }),
    userController.changeRole,
  );
  router.delete(
    "/:id",
    validate({ params: userIdParamsSchema }),
    userController.delete,
  );

  return router;
};
