import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { responseFormatter } from "../../libs/response";
import { toUserResponse } from "./user.mapper";
import type { UserService } from "./user.service";
import type {
  CreateUserDto,
  ListUsersQueryDto,
  UserIdParamsDto,
} from "./user.validation";

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

    res
      .status(StatusCodes.OK)
      .json(
        responseFormatter.paginated(
          users.data.map(toUserResponse),
          users.meta,
          "Users retrieved successfully",
        ),
      );
  };

  /**
   * GET /users/:id
   */
  findById: RequestHandler<UserIdParamsDto> = async (req, res) => {
    const user = await this.userService.findById(req.params.id);

    res
      .status(StatusCodes.OK)
      .json(
        responseFormatter.success(
          toUserResponse(user),
          "User retrieved successfully",
        ),
      );
  };

  /**
   * POST /users
   */
  create: RequestHandler<Record<string, never>, unknown, CreateUserDto> =
    async (req, res) => {
      const user = await this.userService.create(req.body);

      res
        .status(StatusCodes.CREATED)
        .json(
          responseFormatter.success(
            toUserResponse(user),
            "User created successfully",
          ),
        );
    };
}
