import type { InsightIntent, InsightSource } from "@onyx/contracts";

export const INSIGHT_MARKER = "ONYX_INSIGHT_QUESTION";
export const INSIGHT_MAX_TURNS = 10;
export const INSIGHT_LIST_LIMIT = 15;

export interface ClassifiedQuestion {
  intent: InsightIntent;
  subject: string | null;
}

const RULES: ReadonlyArray<[InsightIntent, RegExp]> = [
  ["CYCLES", /\b(cycles?|circular|cicli|circolari)\b/],
  [
    "LARGEST",
    /\b(largest|biggest|longest|heaviest)\b.*\bfiles?\b|\bfile\b.*\bpiù\s+(grandi|grossi|lunghi|pesanti)\b/,
  ],
  [
    "CENTRAL",
    /\b(most\s+)?(central|important|critical|core)\s+files?\b|\bfile\b.*\bpiù\s+(centrali|importanti|critici)\b|\bfile\s+(centrali|principali)\b/,
  ],
  [
    "IMPORTERS",
    /\b(who|what|which(\s+files?)?)\s+(imports?|depends\s+on|requires?)\b|\bimported\s+by\b|\bdependents\s+of\b|\bchi\s+(importa|dipende\s+da)\b|\bquali\s+file\s+importano\b/,
  ],
  [
    "IMPORTS",
    /\bwhat\s+does\b.*\b(import|depend\s+on|require)\b|\b(dependencies|imports)\s+of\b|\bcosa\s+importa\b|\bda\s+cosa\s+dipende\b|\bdipendenze\s+di\b/,
  ],
  [
    "USAGES",
    /\b(where|who|what)\b.*\b(uses?|used|calls?|called|references?|referenced)\b|\busages?\s+of\b|\bdove\s+(si\s+)?(usa|usano|chiama|richiama)\b|\bdove\s+(è|e'|viene)\s+(usat|chiamat|richiamat)|\bchi\s+(usa|chiama)\b/,
  ],
  [
    "DEFINITION",
    /\bwhere\s+is\b.*\b(defined|declared|implemented)\b|\bdefinition\s+of\b|\bdove\s+(è|e'|viene)\s+(definit|dichiarat|implementat)|\bdove\s+si\s+trova\b|\bwhere\s+(is|are)\b/,
  ],
];

const STOPWORDS = new Set(
  "a an the is are was where who what which how does do of in on by to from for and or file files function class type it this that used uses use called call defined declared imports import imported depends dependents dependencies most project code dove chi cosa quale quali è e il lo la i gli le un una di da del della nel nella usa usato usata viene definito definita importa importano dipende file progetto codice si trova".split(
    " ",
  ),
);

export function questionSubject(question: string): string | null {
  const quoted = /[`"'“”‘’]([^`"'“”‘’]{1,120})[`"'“”‘’]/.exec(question);
  if (quoted?.[1]) return quoted[1].trim();
  const path = /([\w@.-]+\/[\w@./-]+|[\w-]+\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|css|json|md))\b/.exec(
    question,
  );
  if (path?.[1]) return path[1].replace(/[.,;:?!]+$/, "");
  const words = question.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) ?? [];
  const candidates = words.filter((word) => !STOPWORDS.has(word.toLowerCase()));
  const code = candidates.filter(
    (word) => /[A-Z_$.]|\w[a-z]+[A-Z]/.test(word.slice(1)) || word.includes("_"),
  );
  return code.at(-1) ?? candidates.at(-1) ?? null;
}

export function classifyQuestion(question: string): ClassifiedQuestion {
  const text = question.toLowerCase();
  for (const [intent, pattern] of RULES) {
    if (!pattern.test(text)) continue;
    if (intent === "CYCLES" || intent === "LARGEST" || intent === "CENTRAL")
      return { intent, subject: null };
    const subject = questionSubject(question);
    if (subject) return { intent, subject };
  }
  return { intent: "OPEN", subject: questionSubject(question) };
}

export interface IndexAnswer {
  answer: string;
  sources: InsightSource[];
}

export function listAnswer(
  heading: string,
  items: readonly { path: string; line: number | null; note?: string }[],
  caveat: string,
): IndexAnswer {
  const shown = items.slice(0, INSIGHT_LIST_LIMIT);
  const lines = shown.map(
    (item) =>
      `- \`${item.path}${item.line !== null ? `:${item.line}` : ""}\`${item.note ? ` — ${item.note}` : ""}`,
  );
  if (items.length > shown.length) lines.push(`- … and ${items.length - shown.length} more`);
  return {
    answer: [heading, "", ...lines, "", `_${caveat}_`].join("\n"),
    sources: shown.map((item) => ({ path: item.path, line: item.line })),
  };
}

export function insightPrompt(input: {
  projectName: string;
  question: string;
  hint: string | null;
}): string {
  return [
    INSIGHT_MARKER,
    `You answer a question about the code of the ${input.projectName} project. You cannot change files or run commands. Use the onyx tools (search_symbols, deps, file_skeleton, expand_symbol) before reading whole files.`,
    `# Question\n${input.question}`,
    input.hint ? `# What the Onyx index already found\n${input.hint}` : null,
    "# Answer\nAnswer in at most 12 lines of Markdown. Cite every claim as `path:line`. Say plainly when the code does not answer the question.",
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}

export function citedSources(text: string): InsightSource[] {
  const found = new Map<string, InsightSource>();
  for (const match of text.matchAll(/`?([\w@./-]+\.[A-Za-z]{1,5})(?::(\d+))?`?/g)) {
    const path = match[1] ?? "";
    if (!path.includes("/") && !/\.(tsx?|jsx?|py|go|rs|css|md|json)$/.test(path)) continue;
    const line = match[2] ? Number(match[2]) : null;
    const key = `${path}:${line ?? ""}`;
    if (!found.has(key)) found.set(key, { path, line });
  }
  return [...found.values()].slice(0, 20);
}
