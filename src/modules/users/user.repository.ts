import type { PrismaClient } from "@prisma/client";

import type {
  CreateUserInput,
  FindUsersInput,
  FindUsersResult,
  User,
} from "./user.entity";

const normalizeEmail = (email: string) => email.toLowerCase();

/**
 * Contract for user persistence.
 *
 * Services depend on this interface instead of a concrete database
 * implementation, which keeps the module dependency-injection friendly.
 */
export interface UserRepository {
  findAll(input: FindUsersInput): Promise<FindUsersResult>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
}

/**
 * Prisma implementation of the user repository.
 *
 * The service layer does not know that Prisma is used here; it only depends on
 * the UserRepository interface.
 */
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  /**
   * Returns paginated users ordered by newest first.
   */
  async findAll(input: FindUsersInput): Promise<FindUsersResult> {
    const skip = (input.page - 1) * input.limit;

    const [users, total] = await Promise.all([
      this.db.user.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take: input.limit,
      }),
      this.db.user.count(),
    ]);

    return { users, total };
  }

  /**
   * Finds a user by id.
   */
  async findById(id: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { id },
    });
  }

  /**
   * Finds a user by normalized email.
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { email: normalizeEmail(email) },
    });
  }

  /**
   * Creates a user.
   */
  async create(input: CreateUserInput): Promise<User> {
    return this.db.user.create({
      data: {
        name: input.name,
        email: normalizeEmail(input.email),
      },
    });
  }
}
