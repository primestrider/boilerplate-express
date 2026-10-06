/**
 * Roles, from least to most privileged. Add new roles here; the database
 * column and token claims follow this list.
 */
export const USER_ROLES = ["user", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Represents a user record returned by the data layer.
 *
 * Keep this type close to the persisted shape. If the API response needs a
 * different shape, create a separate response DTO instead of changing this
 * entity type.
 */
export type User = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
  /** Set when the user was deleted. Repositories never return such users. */
  deletedAt: Date | null;
};

/**
 * Payload required to create a new user.
 *
 * This type is intentionally small so services and repositories only depend on
 * the fields they need.
 */
export type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
};

/**
 * Profile fields a user can change. Omitted fields stay as they are.
 */
export type UpdateUserInput = {
  name?: string | undefined;
  email?: string | undefined;
};

export const USER_SORT_FIELDS = ["createdAt", "name", "email"] as const;

/**
 * Pagination, filter and sort options accepted by user list queries.
 */
export type FindUsersInput = {
  page: number;
  limit: number;
  /** Matches name or email (substring, case-insensitive). */
  search?: string | undefined;
  role?: UserRole | undefined;
  sortBy?: (typeof USER_SORT_FIELDS)[number] | undefined;
  sortOrder?: "asc" | "desc" | undefined;
};

/**
 * User list result returned by repositories.
 */
export type FindUsersResult = {
  users: User[];
  total: number;
};
