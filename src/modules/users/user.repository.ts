import { randomUUID } from "crypto";

import type { CreateUserInput, User } from "./user.entity";

const normalizeEmail = (email: string) => email.toLowerCase();

/**
 * Contract for user persistence.
 *
 * Services depend on this interface instead of a concrete database
 * implementation, which keeps the module dependency-injection friendly.
 */
export interface UserRepository {
  findAll(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: CreateUserInput): Promise<User>;
}

/**
 * In-memory repository used as a boilerplate example.
 *
 * Replace this class with a Prisma, SQL, MongoDB, or external API
 * implementation while keeping the UserRepository interface unchanged.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();
  private readonly emailIndex = new Map<string, string>();

  /**
   * Returns users ordered by newest first.
   */
  async findAll(): Promise<User[]> {
    return Array.from(this.users.values()).sort(
      (firstUser, secondUser) =>
        secondUser.createdAt.getTime() - firstUser.createdAt.getTime(),
    );
  }

  /**
   * Finds a user by id.
   */
  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  /**
   * Finds a user by normalized email.
   */
  async findByEmail(email: string): Promise<User | null> {
    const userId = this.emailIndex.get(normalizeEmail(email));

    return userId ? this.findById(userId) : null;
  }

  /**
   * Creates a user and stores lookup indexes.
   */
  async create(input: CreateUserInput): Promise<User> {
    const now = new Date();
    const user: User = {
      id: randomUUID(),
      name: input.name,
      email: normalizeEmail(input.email),
      createdAt: now,
      updatedAt: now,
    };

    this.users.set(user.id, user);
    this.emailIndex.set(user.email, user.id);

    return user;
  }
}
