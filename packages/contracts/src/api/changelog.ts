import { z } from "zod";
import { CHANGELOG_SECTIONS, CHANGELOG_SOURCES } from "../client";

export const ChangelogSectionSchema = z.enum(CHANGELOG_SECTIONS);
export type ChangelogSection = z.infer<typeof ChangelogSectionSchema>;
export const ChangelogSourceSchema = z.enum(CHANGELOG_SOURCES);
export type ChangelogSource = z.infer<typeof ChangelogSourceSchema>;

export const ChangelogEntryDtoSchema = z.object({
  section: ChangelogSectionSchema,
  scope: z.string().nullable(),
  text: z.string(),
  source: ChangelogSourceSchema,
  ref: z.string(),
});
export type ChangelogEntryDto = z.infer<typeof ChangelogEntryDtoSchema>;

export const ChangelogReleaseDtoSchema = z.object({
  id: z.string(),
  version: z.string(),
  fromRef: z.string().nullable(),
  toRef: z.string(),
  createdAt: z.string(),
});
export type ChangelogReleaseDto = z.infer<typeof ChangelogReleaseDtoSchema>;

export const ChangelogPreviewDtoSchema = z.object({
  fromRef: z.string().nullable(),
  fromLabel: z.string().nullable(),
  toRef: z.string().nullable(),
  version: z.string(),
  commits: z.number().int(),
  tasks: z.number().int(),
  entries: z.array(ChangelogEntryDtoSchema),
  markdown: z.string(),
  file: z.string(),
  fileExists: z.boolean(),
  releases: z.array(ChangelogReleaseDtoSchema),
});
export type ChangelogPreviewDto = z.infer<typeof ChangelogPreviewDtoSchema>;

export const SaveChangelogRequestSchema = z.object({
  version: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[\w.+-]+$/, "Use letters, digits, dots, dashes or plus signs"),
  markdown: z.string().trim().min(1).max(50_000),
});
export type SaveChangelogRequest = z.input<typeof SaveChangelogRequestSchema>;

export const SaveChangelogResponseSchema = z.object({
  release: ChangelogReleaseDtoSchema,
  file: z.string(),
});
export type SaveChangelogResponse = z.infer<typeof SaveChangelogResponseSchema>;
