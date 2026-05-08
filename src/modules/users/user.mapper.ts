import type { User } from "./user.entity";

export type UserResponse = {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Maps internal user entities into API response DTOs.
 *
 * Keep sensitive fields out of this mapper when the user model grows, such as
 * password hashes, reset tokens, or provider metadata.
 */
export const toUserResponse = (user: User): UserResponse => ({
  id: user.id,
  name: user.name,
  email: user.email,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});
