import { HttpError } from "../../shared/errors/http-error";
import type { User } from "../users/user.entity";
import type { UserRepository } from "../users/user.repository";
import type { UserService } from "../users/user.service";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import type { AccessToken, TokenService } from "./token.service";
import type { LoginDto, RegisterDto } from "./authentication.schema";

export type AuthenticationResult = AccessToken & { user: User };

const invalidCredentials = () =>
  HttpError.unauthorized("Invalid email or password", {
    errorCode: "INVALID_CREDENTIALS",
  });

/**
 * Registration and login.
 *
 * User creation rules (e.g. unique email) stay in UserService; this service
 * only adds the password and token handling on top.
 */
export class AuthenticationService {
  /**
   * Hash verified when the email is unknown, so both failure paths take about
   * the same time and response timing does not reveal which emails exist.
   */
  private readonly dummyHash = hashPassword("dummy-password-for-timing");

  constructor(
    private readonly userService: UserService,
    private readonly userRepository: UserRepository,
    private readonly tokenService: TokenService,
  ) {}

  async register(input: RegisterDto): Promise<AuthenticationResult> {
    const user = await this.userService.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
    });

    return { user, ...this.tokenService.sign(user.id) };
  }

  async login(input: LoginDto): Promise<AuthenticationResult> {
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
      await verifyPassword(await this.dummyHash, input.password);
      throw invalidCredentials();
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      throw invalidCredentials();
    }

    if (needsRehash(user.passwordHash)) {
      await this.userRepository.updatePasswordHash(
        user.id,
        await hashPassword(input.password),
      );
    }

    return { user, ...this.tokenService.sign(user.id) };
  }
}
