import { z } from "zod";

export const UsernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[a-zA-Z0-9_.-]+$/, "Use letters, digits, dot, dash or underscore");

export const PasswordSchema = z.string().min(12).max(256);

export const AuthStatusResponseSchema = z.object({
  setupRequired: z.boolean(),
});
export type AuthStatusResponse = z.infer<typeof AuthStatusResponseSchema>;

export const SetupRequestSchema = z.object({
  username: UsernameSchema,
  password: PasswordSchema,
});
export type SetupRequest = z.infer<typeof SetupRequestSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const UserDtoSchema = z.object({
  id: z.string(),
  username: z.string(),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const MeResponseSchema = z.object({
  user: UserDtoSchema,
});
export type MeResponse = z.infer<typeof MeResponseSchema>;
