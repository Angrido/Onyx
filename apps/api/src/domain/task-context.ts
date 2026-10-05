export interface TaskContextSource {
  title: string;
  prompt: string;
  acceptance: readonly string[];
  targetPaths: readonly string[];
}

const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";
const MAX_CONTEXT_CHARS = 8_000;

export function taskContextText(task: TaskContextSource): string {
  const parts = [`Task: ${task.title.trim()}`, task.prompt.trim()];
  if (task.acceptance.length > 0)
    parts.push(["Acceptance criteria:", ...task.acceptance.map((line) => `- ${line}`)].join("\n"));
  if (task.targetPaths.length > 0)
    parts.push(`Files to start from: ${task.targetPaths.join(", ")}`);
  const text = parts.filter((part) => part.length > 0).join("\n\n");
  return text.length > MAX_CONTEXT_CHARS ? `${text.slice(0, MAX_CONTEXT_CHARS - 1)}…` : text;
}

export function bracketedPaste(text: string): string {
  const clean = Array.from(text)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 10 || code === 9 || (code >= 32 && code !== 127);
    })
    .join("");
  return `${PASTE_START}${clean}${PASTE_END}`;
}
