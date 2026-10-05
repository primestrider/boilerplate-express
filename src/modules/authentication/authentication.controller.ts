import type { RequestHandler } from "express";
import { StatusCodes } from "http-status-codes";

import { sendSuccess } from "../../shared/http/response";
import type { UserService } from "../users/user.service";
import { toUserResponse } from "../users/user.mapper";
import type {
  AuthenticationResult,
  AuthenticationService,
} from "./authentication.service";
import { getAuth } from "./authenticate.middleware";
import type {
  AuthenticationResponse,
  LoginDto,
  RefreshDto,
  RegisterDto,
} from "./authentication.schema";

const toAuthenticationResponse = ({
  user,
  ...tokens
}: AuthenticationResult): AuthenticationResponse => ({
  ...tokens,
  user: toUserResponse(user),
});

type NoParams = Record<string, never>;

export class AuthenticationController {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly userService: UserService,
  ) {}

  /**
   * POST /authentication/register
   */
  register: RequestHandler<NoParams, unknown, RegisterDto> = async (
    req,
    res,
  ) => {
    const result = await this.authenticationService.register(req.body);

    sendSuccess(
      res,
      StatusCodes.CREATED,
      toAuthenticationResponse(result),
      "Registered successfully",
    );
  };

  /**
   * POST /authentication/login
   */
  login: RequestHandler<NoParams, unknown, LoginDto> = async (req, res) => {
    const result = await this.authenticationService.login(req.body);

    sendSuccess(
      res,
      StatusCodes.OK,
      toAuthenticationResponse(result),
      "Logged in successfully",
    );
  };

  /**
   * POST /authentication/refresh
   */
  refresh: RequestHandler<NoParams, unknown, RefreshDto> = async (req, res) => {
    const result = await this.authenticationService.refresh(req.body);

    sendSuccess(
      res,
      StatusCodes.OK,
      toAuthenticationResponse(result),
      "Token refreshed successfully",
    );
  };

  /**
   * POST /authentication/logout
   */
  logout: RequestHandler<NoParams, unknown, RefreshDto> = async (req, res) => {
    await this.authenticationService.logout(req.body);

    sendSuccess(res, StatusCodes.OK, undefined, "Logged out successfully");
  };

  /**
   * GET /authentication/profile
   */
  profile: RequestHandler = async (_req, res) => {
    const user = await this.userService.findById(getAuth(res).userId);

    sendSuccess(res, StatusCodes.OK, toUserResponse(user));
  };
}
