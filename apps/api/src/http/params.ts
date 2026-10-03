import { z } from "zod";

export const IdParamsSchema = z.object({ id: z.string().min(1).max(64) });

export function idParam(params: unknown): string {
  return IdParamsSchema.parse(params).id;
}
