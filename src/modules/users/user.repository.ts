import {
  and,
  asc,
  desc,
  eq,
  isNull,
  like,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import type { DB } from "../../db";
import { affectedRows } from "../../db/errors";
import { users } from "../../db/schema";
import { offsetOf } from "../../shared/http/pagination";
import type {
  CreateUserInput,
  FindUsersInput,
  FindUsersResult,
  UpdateUserInput,
  User,
  UserRole,
} from "./user.entity";

const normalizeEmail = (email: string) => email.toLowerCase();

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");

/** Deleted users are invisible to every query except the email check. */
const notDeleted = isNull(users.deletedAt);

const SORT_COLUMNS = {
  createdAt: users.createdAt,
  name: users.name,
  email: users.email,
} as const;

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
  /**
   * True when another user, deleted ones included, has this email. Deleted
   * users keep their email reserved (the column is unique).
   */
  isEmailTaken(email: string, exceptUserId?: string): Promise<boolean>;
  create(input: CreateUserInput): Promise<User>;
  /** Returns the updated user, or null when it does not exist. */
  update(id: string, input: UpdateUserInput): Promise<User | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateRole(id: string, role: UserRole): Promise<void>;
  /** Returns false when the user does not exist (or is already deleted). */
  softDelete(id: string): Promise<boolean>;
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
   * Returns a filtered, sorted page of users (newest first by default).
   */
  async findAll(input: FindUsersInput): Promise<FindUsersResult> {
    const filters: SQL[] = [notDeleted];

    if (input.search) {
      const pattern = `%${escapeLike(input.search)}%`;
      filters.push(or(like(users.name, pattern), like(users.email, pattern))!);
    }
    if (input.role) filters.push(eq(users.role, input.role));

    const where = and(...filters);
    const column = SORT_COLUMNS[input.sortBy ?? "createdAt"];
    const direction = input.sortOrder === "asc" ? asc : desc;

    const [rows, total] = await Promise.all([
      this.db
        .select()
        .from(users)
        .where(where)
        // The id tiebreaker keeps pages stable when sort values are equal.
        .orderBy(direction(column), direction(users.id))
        .limit(input.limit)
        .offset(offsetOf(input)),
      this.db.$count(users, where),
    ]);

    return { users: rows, total };
  }

  async findById(id: string): Promise<User | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), notDeleted))
      .limit(1);

    return user ?? null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.email, normalizeEmail(email)), notDeleted))
      .limit(1);

    return user ?? null;
  }

  async isEmailTaken(email: string, exceptUserId?: string): Promise<boolean> {
    const count = await this.db.$count(
      users,
      and(
        eq(users.email, normalizeEmail(email)),
        exceptUserId ? ne(users.id, exceptUserId) : undefined,
      ),
    );

    return count > 0;
  }

  async create(input: CreateUserInput): Promise<User> {
    const [inserted] = await this.db
      .insert(users)
      .values({
        name: input.name,
        email: normalizeEmail(input.email),
        passwordHash: input.passwordHash,
      })
      .$returningId();

    // MySQL has no RETURNING; read the row back for its defaults.
    const user = inserted && (await this.findById(inserted.id));

    if (!user) {
      throw new Error("Failed to create user");
    }

    return user;
  }

  async update(id: string, input: UpdateUserInput): Promise<User | null> {
    await this.db
      .update(users)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.email !== undefined && {
          email: normalizeEmail(input.email),
        }),
      })
      .where(and(eq(users.id, id), notDeleted));

    return this.findById(id);
  }

  /**
   * Replaces a user's password hash (password change, parameter upgrade).
   */
  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.db.update(users).set({ passwordHash }).where(eq(users.id, id));
  }

  async updateRole(id: string, role: UserRole): Promise<void> {
    await this.db.update(users).set({ role }).where(eq(users.id, id));
  }

  async softDelete(id: string): Promise<boolean> {
    const result = await this.db
      .update(users)
      .set({ deletedAt: new Date() })
      .where(and(eq(users.id, id), notDeleted));

    return affectedRows(result) > 0;
  }
}
