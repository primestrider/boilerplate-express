import { z } from "zod";

/**
 * Validation schema for creating a user.
 *
 * Zod also transforms email into lowercase, so downstream layers receive a
 * normalized value.
 */
export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().toLowerCase(),
});

/**
 * Validation schema for listing users.
 */
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

/**
 * Validation schema for routes that receive a user id in the URL params.
 */
export const userIdParamsSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Request body DTO inferred from createUserSchema.
 */
export type CreateUserDto = z.infer<typeof createUserSchema>;

/**
 * Request query DTO inferred from listUsersQuerySchema.
 */
export type ListUsersQueryDto = z.infer<typeof listUsersQuerySchema>;

/**
 * Request params DTO inferred from userIdParamsSchema.
 */
export type UserIdParamsDto = z.infer<typeof userIdParamsSchema>;
