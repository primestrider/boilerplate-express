import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { sendSuccess, sendPaginated } from "../../shared/http/response";
import { toUserResponse } from "./user.mapper";
import type { UserService } from "./user.service";
import type { ListUsersQueryDto, UserIdParamsDto } from "./user.schema";

/**
 * Handles HTTP requests for the user module.
 *
 * The controller does not contain business rules. It delegates workflows to the
 * service and formats the HTTP response consistently.
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
    const user = await this.userService.findById(req.params.id);

    sendSuccess(
      res,
      StatusCodes.OK,
      toUserResponse(user),
      "User retrieved successfully",
    );
  };
}
