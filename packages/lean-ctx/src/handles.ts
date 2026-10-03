import { createHash } from "node:crypto";

const HANDLE_LENGTH = 8;
const HANDLE_SPACE = 36 ** HANDLE_LENGTH;

export const HANDLE_PATTERN = /^[0-9a-z]{8}$/;

export function symbolHandle(relPath: string, qualifiedName: string): string {
  const digest = createHash("sha256").update(`${relPath}\u0000${qualifiedName}`).digest();
  return (digest.readUIntBE(0, 6) % HANDLE_SPACE).toString(36).padStart(HANDLE_LENGTH, "0");
}

export function blockPlaceholder(handle: string): string {
  return `{ …#${handle} }`;
}

export function inlinePlaceholder(handle: string): string {
  return `…#${handle}`;
}

export const ELIDED_VALUE = "…";

export const PLACEHOLDER_LEGEND =
  "`{ …#h }` or `…#h` marks a body elided by Onyx: pass h as the handle to the expand_symbol tool of the onyx MCP server to read it. A bare `…` marks an elided value.";
