import { desc, eq } from "drizzle-orm";

import { users } from "../../db/schema";
import type { DB } from "../../db";
import type {
  CreateUserInput,
  FindUsersInput,
  FindUsersResult,
  User,
  UserRole,
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
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateRole(id: string, role: UserRole): Promise<void>;
}

/**
 * Drizzle implementation of the user repository.
 *
 * The service layer does not know that Drizzle is used here; it only depends on
 * the UserRepository interface.
 */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly db: DB) {}

  /**
   * Returns paginated users ordered by newest first.
   */
  async findAll(input: FindUsersInput): Promise<FindUsersResult> {
    const offset = (input.page - 1) * input.limit;

    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(input.limit)
        .offset(offset),
      this.db.$count(users),
    ]);

    return { users: rows, total };
  }

  /**
   * Finds a user by id.
   */
  async findById(id: string): Promise<User | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return user ?? null;
  }

  /**
   * Finds a user by normalized email.
   */
  async findByEmail(email: string): Promise<User | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)))
      .limit(1);

    return user ?? null;
  }

  /**
   * Creates a user.
   */
  async create(input: CreateUserInput): Promise<User> {
    const [user] = await this.db
      .insert(users)
      .values({
        name: input.name,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
      })
      .returning();

    if (!user) {
      throw new Error("Failed to create user");
    }

    return user;
  }

  /**
   * Replaces a user's password hash (e.g. after a parameter upgrade).
   */
  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }

  /**
   * Changes a user's role.
   */
  async updateRole(id: string, role: UserRole): Promise<void> {
    await this.db.update(users).set({ role }).where(eq(users.id, id));
  }
}
