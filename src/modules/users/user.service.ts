import { AppError } from "../../libs/app-error";
import type { CreateUserInput, User } from "./user.entity";
import type { UserRepository } from "./user.repository";

/**
 * Contains user business rules.
 *
 * Controllers handle HTTP concerns, repositories handle persistence, and this
 * service keeps the actual user workflow in one place.
 */
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  /**
   * Returns all users.
   */
  async findAll(): Promise<User[]> {
    return this.userRepository.findAll();
  }

  /**
   * Returns a single user or throws a domain-friendly not found error.
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw AppError.notFound("User not found", {
        errorCode: "USER_NOT_FOUND",
      });
    }

    return user;
  }

  /**
   * Creates a user after enforcing email uniqueness.
   */
  async create(input: CreateUserInput): Promise<User> {
    const existingUser = await this.userRepository.findByEmail(input.email);

    if (existingUser) {
      throw AppError.conflict("Email already exists", {
        errorCode: "EMAIL_ALREADY_EXISTS",
      });
    }

    return this.userRepository.create(input);
  }
}
