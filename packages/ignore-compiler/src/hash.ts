import { createHash } from "node:crypto";
import type { ContextPolicy } from "./policy";
import { renderIgnoreFile } from "./rules";

export function policyHash(policy: ContextPolicy): string {
  return createHash("sha256").update(renderIgnoreFile(policy.rules)).digest("hex").slice(0, 16);
}
