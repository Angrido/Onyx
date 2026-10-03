import { z } from "zod";

export const ClaudeCredentialKindSchema = z.enum(["api-key", "oauth-token"]);
export type ClaudeCredentialKind = z.infer<typeof ClaudeCredentialKindSchema>;

export const CredentialSourceSchema = z.enum(["env", "settings"]);
export type CredentialSource = z.infer<typeof CredentialSourceSchema>;

export const ClaudeLoginStateSchema = z.enum(["running", "connected", "failed", "cancelled"]);
export type ClaudeLoginState = z.infer<typeof ClaudeLoginStateSchema>;

export const ClaudeLoginDtoSchema = z.object({
  id: z.string(),
  state: ClaudeLoginStateSchema,
  exitCode: z.number().int().nullable(),
  startedAt: z.string(),
  signInUrl: z.string().nullable(),
  error: z.string().nullable(),
  codeSubmittedAt: z.string().nullable(),
  screen: z.string(),
});
export type ClaudeLoginDto = z.infer<typeof ClaudeLoginDtoSchema>;

export const ClaudeTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  model: z.string().nullable(),
  durationMs: z.number().int(),
  at: z.string(),
});
export type ClaudeTestResult = z.infer<typeof ClaudeTestResultSchema>;

export const ClaudeAccountDtoSchema = z.object({
  configured: z.boolean(),
  source: CredentialSourceSchema.nullable(),
  kind: ClaudeCredentialKindSchema.nullable(),
  hint: z.string().nullable(),
  savedAt: z.string().nullable(),
  cliVersion: z.string().nullable(),
  claudeBin: z.string(),
  simulator: z.boolean(),
  login: ClaudeLoginDtoSchema.nullable(),
  lastTest: ClaudeTestResultSchema.nullable(),
});
export type ClaudeAccountDto = z.infer<typeof ClaudeAccountDtoSchema>;

export const CLAUDE_TOKEN_PATTERN = /sk-ant-(?:oat|api)\d{2}-[A-Za-z0-9_-]{20,}/;

export const SaveClaudeTokenRequestSchema = z.object({
  token: z
    .string()
    .trim()
    .max(512)
    .regex(
      new RegExp(`^${CLAUDE_TOKEN_PATTERN.source}$`),
      "Paste the token printed by claude setup-token (sk-ant-oat01-…) or an API key (sk-ant-api03-…)",
    ),
});
export type SaveClaudeTokenRequest = z.input<typeof SaveClaudeTokenRequestSchema>;

export const SubmitLoginCodeRequestSchema = z.object({
  code: z.string().trim().max(2_000),
});
export type SubmitLoginCodeRequest = z.input<typeof SubmitLoginCodeRequestSchema>;

export const GitIdentityDtoSchema = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  effectiveName: z.string(),
  effectiveEmail: z.string(),
});
export type GitIdentityDto = z.infer<typeof GitIdentityDtoSchema>;

export const UpdateGitIdentityRequestSchema = z.object({
  name: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .transform((value) => (value === null || value.length === 0 ? null : value)),
  email: z
    .string()
    .trim()
    .max(200)
    .regex(/^(?:[^\s@]+@[^\s@]+)?$/, "Invalid email")
    .nullable()
    .transform((value) => (value === null || value.length === 0 ? null : value)),
});
export type UpdateGitIdentityRequest = z.input<typeof UpdateGitIdentityRequestSchema>;
