import { logger } from "../../config/logger";
import type { Cache } from "../../shared/cache/cache";
import type {
  CreateUserInput,
  FindUsersInput,
  FindUsersResult,
  UpdateUserInput,
  User,
  UserRole,
} from "./user.entity";
import type { UserRepository } from "./user.repository";

/** Bounds staleness when the database is changed outside this repository. */
const TTL_SECONDS = 60;

const keyOf = (id: string) => `user:${id}`;

type CachedUser = Omit<User, "createdAt" | "updatedAt" | "deletedAt"> & {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

/** The cache stores JSON, so dates come back as strings. */
const revive = (user: CachedUser): User => ({
  ...user,
  createdAt: new Date(user.createdAt),
  updatedAt: new Date(user.updatedAt),
  deletedAt: user.deletedAt === null ? null : new Date(user.deletedAt),
});

/**
 * Cache-aside decorator: `findById` (profile, user lookups, token refresh) is
 * served from the cache, and every write through this repository evicts the
 * user. Writes made elsewhere (the make-admin CLI, manual SQL) show up within
 * TTL_SECONDS.
 *
 * The cache is an optimization, so its failures (Redis down) are logged and
 * the database answers instead.
 */
export class CachedUserRepository implements UserRepository {
  constructor(
    private readonly inner: UserRepository,
    private readonly cache: Cache,
  ) {}

  async findById(id: string): Promise<User | null> {
    const cached = await this.tryCache(() =>
      this.cache.get<CachedUser>(keyOf(id)),
    );
    if (cached) return revive(cached);

    const user = await this.inner.findById(id);
    // Misses are not cached, so a new user is visible right away.
    if (user)
      await this.tryCache(() => this.cache.set(keyOf(id), user, TTL_SECONDS));

    return user;
  }

  findAll(input: FindUsersInput): Promise<FindUsersResult> {
    return this.inner.findAll(input);
  }

  findByEmail(email: string): Promise<User | null> {
    return this.inner.findByEmail(email);
  }

  isEmailTaken(email: string, exceptUserId?: string): Promise<boolean> {
    return this.inner.isEmailTaken(email, exceptUserId);
  }

  create(input: CreateUserInput): Promise<User> {
    return this.inner.create(input);
  }

  async update(id: string, input: UpdateUserInput): Promise<User | null> {
    const user = await this.inner.update(id, input);
    await this.evict(id);
    return user;
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.inner.updatePasswordHash(id, passwordHash);
    await this.evict(id);
  }

  async updateRole(id: string, role: UserRole): Promise<void> {
    await this.inner.updateRole(id, role);
    await this.evict(id);
  }

  async softDelete(id: string): Promise<boolean> {
    const deleted = await this.inner.softDelete(id);
    await this.evict(id);
    return deleted;
  }

  private evict(id: string) {
    return this.tryCache(() => this.cache.delete(keyOf(id)));
  }

  private async tryCache<T>(operation: () => Promise<T>): Promise<T | null> {
    try {
      return await operation();
    } catch (error) {
      logger.warn("User cache unavailable", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}
