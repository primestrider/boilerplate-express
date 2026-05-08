import { HttpError } from "../../libs/response";
import type { CreateUserInput, FindUsersInput, User } from "./user.entity";
import type { UserRepository } from "./user.repository";

type PaginatedUsers = {
  data: User[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

/**
 * Contains user business rules.
 *
 * Controllers handle HTTP concerns, repositories handle persistence, and this
 * service keeps the actual user workflow in one place.
 */
export class UserService {
  constructor(private readonly userRepository: UserRepository) {}

  /**
   * Returns paginated users.
   */
  async findAll(input: FindUsersInput): Promise<PaginatedUsers> {
    const { users, total } = await this.userRepository.findAll(input);

    return {
      data: users,
      meta: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Returns a single user or throws a domain-friendly not found error.
   */
  async findById(id: string): Promise<User> {
    const user = await this.userRepository.findById(id);

    if (!user) {
      throw HttpError.notFound("User not found", {
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
      throw HttpError.conflict("Email already exists", {
        errorCode: "EMAIL_ALREADY_EXISTS",
      });
    }

    return this.userRepository.create(input);
  }
}
