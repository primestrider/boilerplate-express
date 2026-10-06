import { z } from "zod";

import { userResponseSchema } from "../users/user.mapper";

const email = z.string().trim().email().toLowerCase();

/**
 * Password length follows OWASP: at least 8, and a generous upper bound that
 * still caps hashing work per request.
 */
const password = z.string().min(8).max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  // No length rules on login: they would reveal the password policy and
  // reject nothing an attacker cares about.
  password: z.string().min(1).max(128),
});

/**
 * Body of POST /refresh and POST /logout.
 */
export const refreshSchema = z.object({
  refreshToken: z.string().min(1).max(256),
});

/**
 * Body of POST /change-password.
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: password,
  })
  .refine((body) => body.newPassword !== body.currentPassword, {
    path: ["newPassword"],
    message: "New password must differ from the current one",
  });

/**
 * Response of register, login and refresh.
 */
export const authenticationResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal("Bearer"),
  expiresIn: z.int().describe("Access token lifetime in seconds"),
  refreshToken: z.string(),
  refreshExpiresIn: z.int().describe("Refresh token lifetime in seconds"),
  user: userResponseSchema,
});

export type AuthenticationResponse = z.infer<
  typeof authenticationResponseSchema
>;

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type RefreshDto = z.infer<typeof refreshSchema>;
export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
