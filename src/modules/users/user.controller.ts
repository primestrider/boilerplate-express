import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { sendSuccess, sendPaginated } from "../../shared/http/response";
import { getAuth } from "../authentication/authenticate.middleware";
import { assertOwnerOrRole } from "../authentication/authorize";
import { toUserResponse } from "./user.mapper";
import type { UserService } from "./user.service";
import type {
  ListUsersQueryDto,
  UpdateUserDto,
  UpdateUserRoleDto,
  UserIdParamsDto,
} from "./user.schema";

/**
 * Handles HTTP requests for the user module.
 *
 * The controller does not contain business rules. It checks who may act on
 * which user, delegates the workflow to the service, and formats the
 * response consistently.
 */
export class UserController {
  constructor(private readonly userService: UserService) {}

  /**
   * GET /users
   */
  findAll: RequestHandler<
    Record<string, never>,
    unknown,
    unknown,
    ListUsersQueryDto
  > = async (req, res) => {
    const users = await this.userService.findAll(req.query);

    sendPaginated(
      res,
      StatusCodes.OK,
      users.data.map(toUserResponse),
      users.meta,
      "Users retrieved successfully",
    );
  };

  /**
   * GET /users/:id
   */
  findById: RequestHandler<UserIdParamsDto> = async (req, res) => {
    assertOwnerOrRole(getAuth(res), req.params.id, "admin");

    const user = await this.userService.findById(req.params.id);

    sendSuccess(
      res,
      StatusCodes.OK,
      toUserResponse(user),
      "User retrieved successfully",
    );
  };

  /**
   * PATCH /users/:id
   */
  update: RequestHandler<UserIdParamsDto, unknown, UpdateUserDto> = async (
    req,
    res,
  ) => {
    assertOwnerOrRole(getAuth(res), req.params.id, "admin");

    const user = await this.userService.update(req.params.id, req.body);

    sendSuccess(
      res,
      StatusCodes.OK,
      toUserResponse(user),
      "User updated successfully",
    );
  };

  /**
   * PATCH /users/:id/role (admin only, enforced by the route)
   */
  changeRole: RequestHandler<UserIdParamsDto, unknown, UpdateUserRoleDto> =
    async (req, res) => {
      const user = await this.userService.changeRole(
        getAuth(res).userId,
        req.params.id,
        req.body.role,
      );

      sendSuccess(
        res,
        StatusCodes.OK,
        toUserResponse(user),
        "User role updated successfully",
      );
    };

  /**
   * DELETE /users/:id
   */
  delete: RequestHandler<UserIdParamsDto> = async (req, res) => {
    assertOwnerOrRole(getAuth(res), req.params.id, "admin");

    await this.userService.delete(req.params.id);

    sendSuccess(res, StatusCodes.OK, undefined, "User deleted successfully");
  };
}
