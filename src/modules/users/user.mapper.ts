import { z } from "zod";

import { USER_ROLES, type User } from "./user.entity";

/**
 * Public shape of a user. The schema drives both the TypeScript type and the
 * OpenAPI documentation, so the docs cannot drift from what the API returns.
 */
export const userResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: z.enum(USER_ROLES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

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
  role: user.role,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});
