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
import type { LoginDto, RegisterDto } from "./authentication.schema";

const toAuthenticationResponse = ({
  user,
  ...token
}: AuthenticationResult) => ({
  ...token,
  user: toUserResponse(user),
});

export class AuthenticationController {
  constructor(
    private readonly authenticationService: AuthenticationService,
    private readonly userService: UserService,
  ) {}

  /**
   * POST /authentication/register
   */
  register: RequestHandler<Record<string, never>, unknown, RegisterDto> =
    async (req, res) => {
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
  login: RequestHandler<Record<string, never>, unknown, LoginDto> = async (
    req,
    res,
  ) => {
    const result = await this.authenticationService.login(req.body);

    sendSuccess(
      res,
      StatusCodes.OK,
      toAuthenticationResponse(result),
      "Logged in successfully",
    );
  };

  /**
   * GET /authentication/profile
   */
  profile: RequestHandler = async (_req, res) => {
    const user = await this.userService.findById(getAuth(res).userId);

    sendSuccess(res, StatusCodes.OK, toUserResponse(user));
  };
}
