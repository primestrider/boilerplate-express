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
  createdAt: Date;
  updatedAt: Date;
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
};

/**
 * Pagination options accepted by user list queries.
 */
export type FindUsersInput = {
  page: number;
  limit: number;
};

/**
 * User list result returned by repositories.
 */
export type FindUsersResult = {
  users: User[];
  total: number;
};
