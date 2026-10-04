export interface PrimerInput {
  workspacePrimer: string | null;
  agentPrompt: string | null;
  projectName: string;
  map: { text: string; includedFiles: number; omittedFiles: number } | null;
  memory?: string | null;
  concise?: boolean;
  mcpEnabled: boolean;
}

export const CONCISE_GUIDE = [
  "## Final message",
  "End the run with a short summary of at most 6 lines: what you changed, how you checked it and anything left open. Do not repeat code, diffs or file contents: Onyx shows the diff.",
].join("\n");

const TOOL_GUIDE = [
  "## Onyx context tools",
  "The `onyx` MCP server gives cheap, precise access to this codebase:",
  "- `expand_symbol` with a `handle`: full source of a symbol whose body appears elided as `{ …#handle }` or `…#handle`.",
  "- `file_skeleton` with a `path` and `level` 1 (signatures) or 2 (contracts): a file's outline without its bodies.",
  "- `deps` with a `path`: the file's neighbourhood in the import graph.",
  "- `search_symbols` with a `query`: declarations and their handles.",
  "Prefer these tools to reading whole files; read a full file only when you are about to edit it.",
].join("\n");

function present(text: string | null): text is string {
  return text !== null && text.trim().length > 0;
}

export function composePrimer(input: PrimerInput): string {
  const sections: string[] = [];
  if (present(input.workspacePrimer)) sections.push(input.workspacePrimer.trim());
  if (present(input.agentPrompt)) sections.push(input.agentPrompt.trim());
  if (input.map) {
    const hidden = input.map.omittedFiles > 0 ? `, ${input.map.omittedFiles} more not shown` : "";
    sections.push(
      [
        "## Onyx project map",
        `${input.projectName}: ${input.map.includedFiles} files${hidden}. Each line is \`file ~tokens: exports\`, grouped by directory and limited to the most central files.`,
        input.map.text,
      ].join("\n"),
    );
  }
  if (input.memory && present(input.memory)) sections.push(input.memory.trim());
  if (input.mcpEnabled) sections.push(TOOL_GUIDE);
  if (input.concise) sections.push(CONCISE_GUIDE);
  return sections.join("\n\n");
}

export function composeUserMessage(
  contextPack: string | null,
  prompt: string,
  handoff: string | null = null,
): string {
  const preamble = [handoff, contextPack].filter(present).map((part) => part.trim());
  if (preamble.length === 0) return prompt;
  return `${preamble.join("\n\n---\n\n")}\n\n---\n\n# Task\n\n${prompt}`;
}
