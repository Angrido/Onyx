import { createHash } from "node:crypto";
import type { FindingCategory, FindingSeverity, FindingVerdict, TaskKind } from "@onyx/contracts";
import { interpolate, msg, tx } from "../i18n";
import { translateKnown } from "./insights";

export const IDEATION_MARKER = "ONYX_IDEATION_REVIEW";
export const MAX_SCAN_BYTES = 200_000;
export const MAX_FINDINGS_PER_RULE = 25;
export const MAX_REVIEWED = 20;
export const SNIPPET_CONTEXT_LINES = 5;
export const REVIEW_MAX_TURNS = 6;
const VULNERABLE_TITLE = msg("Vulnerable dependency: {name}");
const HOTSPOT_EXCERPT = msg("~{tokens} tokens, imported by {count} files");

export interface StaticFinding {
  category: FindingCategory;
  severity: FindingSeverity;
  rule: string;
  title: string;
  file: string | null;
  line: number | null;
  excerpt: string | null;
  explanation: string;
  confidence: number;
  source: "STATIC" | "AUDIT" | "GRAPH";
}

interface LineRule {
  rule: string;
  category: FindingCategory;
  severity: FindingSeverity;
  confidence: number;
  title: string;
  explanation: string;
  pattern: RegExp;
  languages?: readonly string[];
  paths?: RegExp;
  skipTests?: boolean;
}

const JS = ["typescript", "tsx", "javascript", "jsx"];
const PY = ["python"];

const LINE_RULES: readonly LineRule[] = [
  {
    rule: "eval",
    category: "SECURITY",
    severity: "HIGH",
    confidence: 0.7,
    title: msg("Code built from strings at run time"),
    explanation: msg(
      "eval and new Function run arbitrary code; with outside input this is code injection.",
    ),
    pattern: /\beval\s*\(|\bnew\s+Function\s*\(/,
    languages: JS,
  },
  {
    rule: "shell-injection",
    category: "SECURITY",
    severity: "HIGH",
    confidence: 0.6,
    title: msg("Shell command built from variables"),
    explanation: msg(
      "A shell command assembled with interpolated values can run whatever the value contains.",
    ),
    pattern: /\b(exec|execSync)\s*\(\s*`[^`]*\$\{|\bshell\s*:\s*true\b/,
    languages: JS,
  },
  {
    rule: "sql-concatenation",
    category: "SECURITY",
    severity: "HIGH",
    confidence: 0.6,
    title: msg("SQL built by concatenating values"),
    explanation: msg(
      "Values joined into an SQL string instead of passed as parameters allow SQL injection.",
    ),
    pattern:
      /\b(query|execute|raw|\$queryRawUnsafe|\$executeRawUnsafe)\s*\(\s*(`[^`]*\$\{|["'][^"']*\b(select|insert|update|delete)\b[^"']*["']\s*\+)/i,
  },
  {
    rule: "html-injection",
    category: "SECURITY",
    severity: "MEDIUM",
    confidence: 0.5,
    title: msg("Raw HTML written into the page"),
    explanation: msg(
      "innerHTML and dangerouslySetInnerHTML render markup as is: unescaped user content becomes XSS.",
    ),
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=/,
    languages: JS,
  },
  {
    rule: "hardcoded-secret",
    category: "SECURITY",
    severity: "HIGH",
    confidence: 0.55,
    title: msg("Secret written in the source"),
    explanation: msg(
      "Keys and passwords in the code end up in git history and in every copy of the project.",
    ),
    pattern:
      /\b(api[_-]?key|secret|password|passwd|access[_-]?token)\b\s*[:=]\s*["'][^"'\s]{12,}["']|AKIA[0-9A-Z]{16}/i,
    skipTests: true,
  },
  {
    rule: "tls-disabled",
    category: "SECURITY",
    severity: "HIGH",
    confidence: 0.7,
    title: msg("TLS certificate checks turned off"),
    explanation: msg(
      "Without certificate checks anyone on the network path can read and change the traffic.",
    ),
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED|verify\s*=\s*False/,
    skipTests: true,
  },
  {
    rule: "weak-hash",
    category: "SECURITY",
    severity: "MEDIUM",
    confidence: 0.4,
    title: msg("MD5 or SHA-1 hash"),
    explanation: msg(
      "MD5 and SHA-1 are broken for passwords and signatures; fine only for non-security checksums.",
    ),
    pattern: /createHash\(\s*["'](md5|sha1)["']\)|hashlib\.(md5|sha1)\(/,
  },
  {
    rule: "insecure-random",
    category: "SECURITY",
    severity: "MEDIUM",
    confidence: 0.45,
    title: msg("Math.random for a secret value"),
    explanation: msg(
      "Math.random is predictable; tokens, ids and passwords need crypto.randomBytes or randomUUID.",
    ),
    pattern: /(token|secret|password|nonce|salt|session)\w*\s*[:=][^;\n]*Math\.random\(\)/i,
    languages: JS,
  },
  {
    rule: "python-unsafe",
    category: "SECURITY",
    severity: "HIGH",
    confidence: 0.6,
    title: msg("Unsafe Python call"),
    explanation: msg(
      "pickle, yaml.load without a safe loader, os.system and shell=True run what the input says.",
    ),
    pattern:
      /\bpickle\.loads?\(|\byaml\.load\((?![^)]*Loader)|\bsubprocess\.\w+\([^)]*shell\s*=\s*True|\bos\.system\(/,
    languages: PY,
  },
  {
    rule: "sync-fs-in-server",
    category: "PERFORMANCE",
    severity: "LOW",
    confidence: 0.4,
    title: msg("Blocking file call in server code"),
    explanation: msg("Synchronous file calls block every request while they run."),
    pattern: /\b(readFileSync|writeFileSync|readdirSync|statSync)\(/,
    languages: JS,
    paths: /(^|\/)(routes?|api|server|handlers?|controllers?)(\/|\.)/,
    skipTests: true,
  },
];

const LOOP_HEADER =
  /^\s*(for\s*\(|for\s+\w+\s+(in|of)\b|while\s*\(|for\s+\w+\s+in\s+)|\.(forEach|map)\(\s*(async\s*)?\(?/;
const DB_CALL =
  /\b(prisma\.\w+\.(find\w*|create\w*|update\w*|delete\w*|upsert|count|aggregate)|\w+\.(query|execute)\(|db\.\w+\(|fetch\(|axios\.\w+\()/;

export function isTestFile(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|fixtures?)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_\w+\.py$/.test(
    path,
  );
}

function indent(line: string): number {
  return line.length - line.trimStart().length;
}

function insideLoop(lines: readonly string[], index: number): boolean {
  const own = indent(lines[index] ?? "");
  for (let back = index - 1; back >= Math.max(0, index - 12); back -= 1) {
    const line = lines[back] ?? "";
    if (line.trim().length === 0) continue;
    const level = indent(line);
    if (level >= own) continue;
    if (LOOP_HEADER.test(line)) return true;
    if (
      /^\s*(function\b|async\s+function\b|\w+\s*\([^)]*\)\s*\{|[a-z_]\w*\s*=\s*(async\s*)?\(|def\s|class\s)/i.test(
        line,
      )
    )
      return false;
  }
  return false;
}

export function scanSource(
  relPath: string,
  language: string | null,
  content: string,
): StaticFinding[] {
  const lines = content.split("\n");
  const test = isTestFile(relPath);
  const found: StaticFinding[] = [];
  for (const [index, text] of lines.entries()) {
    if (text.length > 400) continue;
    const trimmed = text.trim();
    if (/^(\/\/|#|\*|\/\*)/.test(trimmed)) continue;
    for (const rule of LINE_RULES) {
      if (rule.languages && (!language || !rule.languages.includes(language))) continue;
      if (rule.paths && !rule.paths.test(relPath)) continue;
      if (rule.skipTests && test) continue;
      if (!rule.pattern.test(text)) continue;
      found.push({
        category: rule.category,
        severity: rule.severity,
        rule: rule.rule,
        title: rule.title,
        file: relPath,
        line: index + 1,
        excerpt: trimmed.slice(0, 200),
        explanation: rule.explanation,
        confidence: rule.confidence,
        source: "STATIC",
      });
    }
    if (test || !language || ![...JS, ...PY].includes(language)) continue;
    const awaited = /\bawait\b/.test(text) && !/\bfor\s+await\b/.test(text);
    if ((awaited || DB_CALL.test(text)) && insideLoop(lines, index)) {
      const query = DB_CALL.test(text);
      found.push({
        category: "PERFORMANCE",
        severity: query ? "MEDIUM" : "LOW",
        rule: query ? "query-in-loop" : "await-in-loop",
        title: query ? msg("Query or request inside a loop") : msg("Await inside a loop"),
        file: relPath,
        line: index + 1,
        excerpt: trimmed.slice(0, 200),
        explanation: query
          ? msg(
              "One query or request per item (N+1): a single batched call is usually much faster.",
            )
          : msg(
              "Each iteration waits for the previous one; independent work can run with Promise.all.",
            ),
        confidence: query ? 0.55 : 0.4,
        source: "STATIC",
      });
    }
  }
  return found;
}

export function graphFindings(input: {
  cycles: readonly (readonly string[])[];
  hotspots: readonly { relPath: string; rawTokens: number; inDegree: number }[];
}): StaticFinding[] {
  const cycles = input.cycles.slice(0, MAX_FINDINGS_PER_RULE).map((cycle): StaticFinding => ({
    category: "MAINTAINABILITY",
    severity: "MEDIUM",
    rule: "import-cycle",
    title: msg("Import cycle"),
    file: cycle[0] ?? null,
    line: null,
    excerpt: [...cycle, cycle[0]].join(" → "),
    explanation: msg(
      "Files that import each other load in a fragile order and cannot change independently.",
    ),
    confidence: 0.8,
    source: "GRAPH",
  }));
  const hotspots = input.hotspots.map((file): StaticFinding => ({
    category: "MAINTAINABILITY",
    severity: "LOW",
    rule: "hotspot",
    title: msg("Large file many others depend on"),
    file: file.relPath,
    line: null,
    excerpt: interpolate(HOTSPOT_EXCERPT, { tokens: file.rawTokens, count: file.inDegree }),
    explanation: msg(
      "Every change here risks many callers and costs agents a lot of context: splitting it helps both.",
    ),
    confidence: 0.5,
    source: "GRAPH",
  }));
  return [...cycles, ...hotspots];
}

const AUDIT_SEVERITY: Record<string, FindingSeverity> = {
  critical: "HIGH",
  high: "HIGH",
  moderate: "MEDIUM",
  low: "LOW",
  info: "LOW",
};

export function parseNpmAudit(raw: unknown, manifest: string): StaticFinding[] {
  if (typeof raw !== "object" || raw === null) return [];
  const vulnerabilities = (raw as Record<string, unknown>)["vulnerabilities"];
  const advisories = (raw as Record<string, unknown>)["advisories"];
  const found: StaticFinding[] = [];
  const add = (name: string, severity: string, detail: string) =>
    found.push({
      category: "DEPENDENCY",
      severity: AUDIT_SEVERITY[severity] ?? "MEDIUM",
      rule: "vulnerable-dependency",
      title: interpolate(VULNERABLE_TITLE, { name }),
      file: manifest,
      line: null,
      excerpt: detail.slice(0, 200),
      explanation: msg(
        "A known vulnerability is reported for this package version: update it or check whether the affected code is used.",
      ),
      confidence: 0.9,
      source: "AUDIT",
    });
  if (typeof vulnerabilities === "object" && vulnerabilities !== null)
    for (const [name, entry] of Object.entries(vulnerabilities as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const via = Array.isArray(record["via"]) ? record["via"] : [];
      const titles = via.flatMap((item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>)["title"] === "string"
          ? [(item as Record<string, unknown>)["title"] as string]
          : [],
      );
      add(
        name,
        typeof record["severity"] === "string" ? record["severity"] : "moderate",
        titles.join("; ") ||
          `${name} ${typeof record["range"] === "string" ? record["range"] : ""}`.trim(),
      );
    }
  else if (typeof advisories === "object" && advisories !== null)
    for (const entry of Object.values(advisories as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      add(
        typeof record["module_name"] === "string" ? record["module_name"] : "package",
        typeof record["severity"] === "string" ? record["severity"] : "moderate",
        typeof record["title"] === "string" ? record["title"] : "",
      );
    }
  return found.slice(0, MAX_FINDINGS_PER_RULE * 2);
}

export function translateFinding(finding: {
  rule: string;
  title: string;
  excerpt: string | null;
  explanation: string;
}): { title: string; excerpt: string | null; explanation: string } {
  const title = translateKnown(finding.title, [VULNERABLE_TITLE]);
  return {
    title: title === finding.title ? tx(title) : title,
    excerpt:
      finding.rule === "hotspot" && finding.excerpt !== null
        ? translateKnown(finding.excerpt, [HOTSPOT_EXCERPT])
        : finding.excerpt,
    explanation: tx(finding.explanation),
  };
}

export function capPerRule(findings: readonly StaticFinding[]): StaticFinding[] {
  const counts = new Map<string, number>();
  return findings.filter((finding) => {
    const count = (counts.get(finding.rule) ?? 0) + 1;
    counts.set(finding.rule, count);
    return count <= MAX_FINDINGS_PER_RULE;
  });
}

export function fingerprint(finding: Pick<StaticFinding, "rule" | "file" | "excerpt">): string {
  return createHash("sha256")
    .update(
      `${finding.rule}|${finding.file ?? ""}|${(finding.excerpt ?? "").replace(/\s+/g, " ").trim()}`,
    )
    .digest("hex")
    .slice(0, 32);
}

export function snippet(content: string, line: number, context = SNIPPET_CONTEXT_LINES): string {
  const lines = content.split("\n");
  const start = Math.max(0, line - 1 - context);
  const end = Math.min(lines.length, line + context);
  return lines
    .slice(start, end)
    .map(
      (text, offset) =>
        `${String(start + offset + 1).padStart(5)}${start + offset + 1 === line ? ">" : " "} ${text}`,
    )
    .join("\n");
}

export const IDEATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "verdict", "confidence", "explanation"],
        properties: {
          id: { type: "string" },
          verdict: { type: "string", enum: ["real", "false_positive", "unsure"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          explanation: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
} as const;

export function reviewPrompt(
  items: readonly { id: string; title: string; rule: string; file: string; snippet: string }[],
): string {
  return [
    IDEATION_MARKER,
    "Static rules flagged the code below as possibly unsafe or slow. For each item decide whether it is a real problem, a false positive, or unsure, from the snippet and, only if needed, the file. Do not change anything.",
    ...items.map(
      (item) =>
        `## Item ${item.id}: ${item.title} (${item.rule})\n${item.file}\n\`\`\`\n${item.snippet}\n\`\`\``,
    ),
    "Answer with the JSON the schema asks for: one entry per item, with `confidence` as how sure you are that it is a real problem (0 to 1), a one-sentence explanation and, for real problems, a one-sentence fix.",
  ].join("\n\n");
}

export interface ReviewedFinding {
  id: string;
  verdict: FindingVerdict;
  confidence: number;
  explanation: string;
  fix: string | null;
}

const VERDICTS: Record<string, FindingVerdict> = {
  real: "REAL",
  false_positive: "FALSE_POSITIVE",
  unsure: "UNSURE",
};

export function readReview(raw: unknown, ids: ReadonlySet<string>): ReviewedFinding[] {
  if (typeof raw !== "object" || raw === null) return [];
  const list = (raw as Record<string, unknown>)["findings"];
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): ReviewedFinding[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const id = typeof record["id"] === "string" ? record["id"] : "";
    const verdict = VERDICTS[typeof record["verdict"] === "string" ? record["verdict"] : ""];
    if (!ids.has(id) || !verdict) return [];
    const confidence = typeof record["confidence"] === "number" ? record["confidence"] : 0.5;
    return [
      {
        id,
        verdict,
        confidence: Math.min(1, Math.max(0, confidence)),
        explanation:
          typeof record["explanation"] === "string" ? record["explanation"].slice(0, 600) : "",
        fix:
          typeof record["fix"] === "string" && record["fix"].trim()
            ? record["fix"].slice(0, 600)
            : null,
      },
    ];
  });
}

export const CATEGORY_KINDS: Record<FindingCategory, TaskKind> = {
  SECURITY: "BUGFIX",
  PERFORMANCE: "REFACTOR",
  MAINTAINABILITY: "REFACTOR",
  DEPENDENCY: "CHORE",
};

export function findingTaskPrompt(finding: {
  title: string;
  rule: string;
  file: string | null;
  line: number | null;
  excerpt: string | null;
  explanation: string;
  fix: string | null;
}): string {
  return [
    `${finding.title}${finding.file ? ` in ${finding.file}${finding.line !== null ? `:${finding.line}` : ""}` : ""}.`,
    finding.excerpt ? `Flagged code:\n\`\`\`\n${finding.excerpt}\n\`\`\`` : null,
    `Why: ${finding.explanation}`,
    finding.fix ? `Suggested fix: ${finding.fix}` : null,
    `Check first that the problem is real (Onyx rule \`${finding.rule}\`); if it is not, say so and change nothing.`,
  ]
    .filter((part): part is string => part !== null)
    .join("\n\n");
}
