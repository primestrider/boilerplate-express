import type { RequestHandler } from "express";

import { sendCreated, sendSuccess } from "../../libs/http-response";
import type { UserService } from "./user.service";
import type { CreateUserDto, UserIdParamsDto } from "./user.validation";

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
  findAll: RequestHandler = async (_req, res) => {
    const users = await this.userService.findAll();

    sendSuccess(res, users, "Users retrieved successfully");
  };

  /**
   * GET /users/:id
   */
  findById: RequestHandler<UserIdParamsDto> = async (req, res) => {
    const user = await this.userService.findById(req.params.id);

    sendSuccess(res, user, "User retrieved successfully");
  };

  /**
   * POST /users
   */
  create: RequestHandler<Record<string, never>, unknown, CreateUserDto> =
    async (req, res) => {
      const user = await this.userService.create(req.body);

      sendCreated(res, user, "User created successfully");
    };
}
