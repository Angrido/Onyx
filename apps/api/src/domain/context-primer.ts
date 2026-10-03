export interface PrimerInput {
  workspacePrimer: string | null;
  agentPrompt: string | null;
  projectName: string;
  map: { text: string; includedFiles: number; omittedFiles: number } | null;
  mcpEnabled: boolean;
}

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
  if (input.mcpEnabled) sections.push(TOOL_GUIDE);
  return sections.join("\n\n");
}

export function composeUserMessage(contextPack: string | null, prompt: string): string {
  if (!present(contextPack)) return prompt;
  return `${contextPack.trim()}\n\n---\n\n# Task\n\n${prompt}`;
}
