import { z } from "zod";
import { SessionEndReasonSchema } from "../domain";

export const TerminalStateSchema = z.enum(["running", "exited"]);
export type TerminalState = z.infer<typeof TerminalStateSchema>;

export const TerminalInjectionActionSchema = z.enum(["clear", "compact"]);
export type TerminalInjectionAction = z.infer<typeof TerminalInjectionActionSchema>;

export const TerminalInjectionSchema = z.object({
  action: TerminalInjectionActionSchema,
  reason: SessionEndReasonSchema.nullable(),
  handoff: z.boolean(),
  at: z.string(),
});
export type TerminalInjection = z.infer<typeof TerminalInjectionSchema>;

export const TerminalDtoSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string(),
  sessionId: z.string(),
  claudeSessionId: z.string().nullable(),
  modelId: z.string(),
  state: TerminalStateSchema,
  pid: z.number().int().nullable(),
  exitCode: z.number().int().nullable(),
  startedAt: z.string(),
  contextTokens: z.number().int(),
  maxSessionTokens: z.number().int(),
  pending: TerminalInjectionSchema.nullable(),
  lastInjection: TerminalInjectionSchema.nullable(),
});
export type TerminalDto = z.infer<typeof TerminalDtoSchema>;

export const OpenTerminalRequestSchema = z.object({
  modelId: z.string().min(1).max(128).optional(),
  cols: z.number().int().min(20).max(500).default(120),
  rows: z.number().int().min(5).max(200).default(32),
  fresh: z.boolean().default(false),
});
export type OpenTerminalRequest = z.input<typeof OpenTerminalRequestSchema>;

export const InjectTerminalRequestSchema = z.object({
  action: TerminalInjectionActionSchema,
  handoff: z.boolean().default(true),
});
export type InjectTerminalRequest = z.input<typeof InjectTerminalRequestSchema>;

export const TerminalTaskContextRequestSchema = z.object({
  taskId: z.string().min(1),
});
export type TerminalTaskContextRequest = z.input<typeof TerminalTaskContextRequestSchema>;

export const TerminalListResponseSchema = z.object({ items: z.array(TerminalDtoSchema) });
export type TerminalListResponse = z.infer<typeof TerminalListResponseSchema>;

export const StatusLineInputSchema = z.looseObject({
  session_id: z.string().optional(),
  context_window: z
    .looseObject({
      context_window_size: z.number().optional(),
      current_usage: z
        .looseObject({
          input_tokens: z.number().optional(),
          cache_read_input_tokens: z.number().optional(),
          cache_creation_input_tokens: z.number().optional(),
        })
        .nullable()
        .optional(),
    })
    .optional(),
});
export type StatusLineInput = z.infer<typeof StatusLineInputSchema>;

export const SessionStartInputSchema = z.looseObject({
  session_id: z.string().min(1),
  source: z.string().default("startup"),
  transcript_path: z.string().optional(),
});
export type SessionStartInput = z.infer<typeof SessionStartInputSchema>;

export const TerminalListQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
});
export type TerminalListQuery = z.infer<typeof TerminalListQuerySchema>;
