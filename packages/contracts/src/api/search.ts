import { z } from "zod";
import { SEARCH_KINDS } from "../client";

export { SEARCH_MARK_END, SEARCH_MARK_START } from "../client";

export const SearchKindSchema = z.enum(SEARCH_KINDS);
export type SearchKind = z.infer<typeof SearchKindSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type SearchQuery = z.input<typeof SearchQuerySchema>;

export const SearchResultSchema = z.object({
  kind: SearchKindSchema,
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  title: z.string(),
  snippet: z.string(),
  status: z.string().nullable(),
  href: z.string(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  query: z.string(),
  items: z.array(SearchResultSchema),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
