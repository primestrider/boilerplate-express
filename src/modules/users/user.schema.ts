import { z } from "zod";

import { paginationQuerySchema } from "../../shared/http/pagination";
import { USER_ROLES, USER_SORT_FIELDS } from "./user.entity";

/**
 * Validation schema for listing users.
 */
export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe("Matches name or email"),
  role: z.enum(USER_ROLES).optional(),
  sortBy: z.enum(USER_SORT_FIELDS).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * Validation schema for routes that receive a user id in the URL params.
 */
export const userIdParamsSchema = z.object({
  id: z.uuid(),
});

/**
 * Body of PATCH /users/:id. At least one field is required.
 */
export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    email: z.string().trim().email().max(255).toLowerCase().optional(),
  })
  .refine((body) => body.name !== undefined || body.email !== undefined, {
    message: "Provide at least one field to update",
  });

/**
 * Body of PATCH /users/:id/role.
 */
export const updateUserRoleSchema = z.object({
  role: z.enum(USER_ROLES),
});

export type ListUsersQueryDto = z.infer<typeof listUsersQuerySchema>;
export type UserIdParamsDto = z.infer<typeof userIdParamsSchema>;
export type UpdateUserDto = z.infer<typeof updateUserSchema>;
export type UpdateUserRoleDto = z.infer<typeof updateUserRoleSchema>;
