import type { RunItem } from "@onyx/contracts";
import { describe, expect, it } from "vitest";
import {
  compareMemoryArms,
  composeMemory,
  drawMemoryArm,
  errorLine,
  extractFacts,
  factLine,
  isExpired,
  normalizeCommand,
  statusFor,
  testFact,
  type StoredFact,
} from "../../src/domain/memory";

const ROOT = "/srv/shop";

function use(id: string, name: string, input: unknown, parent: string | null = null): RunItem {
  return {
    kind: "tool_use",
    messageId: `m-${id}`,
    toolUseId: id,
    name,
    input,
    inputTruncated: false,
    parentToolUseId: parent,
  };
}

function result(id: string, content: string, isError = false): RunItem {
  return {
    kind: "tool_result",
    toolUseId: id,
    isError,
    content,
    truncated: false,
    parentToolUseId: null,
  };
}

describe("facts from a run", () => {
  it("keeps useful commands that worked, files read and failures", () => {
    const facts = extractFacts(
      [
        use("1", "Bash", { command: "cd /srv/shop && pnpm --filter web test 2>&1 | tail -20" }),
        result("1", "Tests 4 passed"),
        use("2", "Bash", { command: "ls -la src" }),
        result("2", "math.ts"),
        use("3", "Read", { file_path: `${ROOT}/src/math.ts` }),
        result("3", "export function add"),
        use("4", "Read", { file_path: "/etc/passwd" }),
        use("5", "Bash", { command: "pnpm build" }),
        result(
          "5",
          "> tsc\nsrc/db.ts(3,1): error TS2307: Cannot find module './generated/client'",
          true,
        ),
        use("6", "Bash", { command: "pnpm lint" }),
        result("6", "eslint: 1 problem\nError: no-comments", true),
        use("7", "Bash", { command: "pnpm lint" }),
        result("7", "ok"),
        use("8", "Read", { file_path: `${ROOT}/src/inner.ts` }, "parent"),
        use("9", "Bash", { command: "echo `whoami` && pnpm test" }),
        result("9", "ok"),
      ],
      ROOT,
    );
    expect(facts.map((fact) => [fact.kind, fact.subject, fact.detail])).toEqual([
      ["COMMAND", "pnpm --filter web test", null],
      ["FILE", "src/math.ts", null],
      [
        "PITFALL",
        "pnpm build",
        "src/db.ts(3,1): error TS2307: Cannot find module './generated/client'",
      ],
      ["COMMAND", "pnpm lint", null],
    ]);
    expect(facts[2]?.key).toBe("pnpm build|<path>(n,n): error tsn: cannot find module '<path>'");
  });

  it("refuses commands that are only reads, too long or dynamic", () => {
    expect(normalizeCommand("git status")).toBeNull();
    expect(normalizeCommand("grep -r test src")).toBeNull();
    expect(normalizeCommand(`pnpm test ${"x".repeat(200)}`)).toBeNull();
    expect(normalizeCommand("pnpm test $(cat list)")).toBeNull();
    expect(normalizeCommand("make\nrm -rf /")).toBeNull();
    expect(normalizeCommand("cargo build --release")).toBe("cargo build --release");
    expect(errorLine("all good\nnothing to see")).toBeNull();
    expect(errorLine("FAIL  src/a.test.ts > adds\u0007 `x`")).toBe("FAIL src/a.test.ts > adds 'x'");
    expect(testFact("pnpm vitest run")?.kind).toBe("TEST");
    expect(testFact("echo `id`")).toBeNull();
  });

  it("needs more runs before trusting files and failures", () => {
    expect(statusFor("COMMAND", 1)).toBe("ACTIVE");
    expect(statusFor("FILE", 2)).toBe("CANDIDATE");
    expect(statusFor("FILE", 3)).toBe("ACTIVE");
    expect(statusFor("PITFALL", 1)).toBe("CANDIDATE");
    expect(statusFor("PITFALL", 2)).toBe("SUGGESTED");
  });
});

describe("composed memory", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  const fact = (id: string, overrides: Partial<StoredFact>): StoredFact => ({
    id,
    kind: "COMMAND",
    subject: id,
    detail: null,
    text: null,
    evidence: 1,
    status: "ACTIVE",
    pinned: false,
    lastSeenAt: now,
    ...overrides,
  });
  const count = (text: string) => Math.ceil(text.length / 4);

  it("orders by pin and kind, stays under the budget and skips old facts", () => {
    const facts = [
      fact("pnpm lint", { evidence: 5 }),
      fact("src/app.ts", { kind: "FILE", evidence: 4 }),
      fact("Use pnpm, never npm", { kind: "NOTE", pinned: true }),
      fact("pnpm test", { kind: "TEST" }),
      fact("old", { lastSeenAt: new Date("2026-08-01T00:00:00Z") }),
      fact("hidden", { status: "SUGGESTED" }),
    ];
    const memory = composeMemory(facts, { budgetTokens: 800, expiryDays: 30, now, count });
    expect(memory?.text.split("\n").slice(2)).toEqual([
      "- Use pnpm, never npm",
      "- Tests pass with `pnpm test` (TDD loop, 2026-10-04)",
      "- `pnpm lint` works (5 runs, last 2026-10-04)",
      "- `src/app.ts` is read often (4 runs)",
    ]);
    expect(memory?.factIds).toEqual([
      "Use pnpm, never npm",
      "pnpm test",
      "pnpm lint",
      "src/app.ts",
    ]);
    const small = composeMemory(facts, { budgetTokens: 60, expiryDays: 30, now, count });
    expect(small?.omitted).toBeGreaterThan(0);
    expect(small?.tokens).toBeLessThanOrEqual(60);
    expect(composeMemory([], { budgetTokens: 800, expiryDays: 30, now, count })).toBeNull();
  });

  it("lets notes, pins and edited text win", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    expect(isExpired({ kind: "NOTE", pinned: false, lastSeenAt: old }, 30, now)).toBe(false);
    expect(isExpired({ kind: "COMMAND", pinned: true, lastSeenAt: old }, 30, now)).toBe(false);
    expect(isExpired({ kind: "COMMAND", pinned: false, lastSeenAt: old }, 30, now)).toBe(true);
    expect(factLine(fact("x", { text: "Run `make dev` first" }))).toBe("Run `make dev` first");
    expect(
      factLine(fact("pnpm build", { kind: "PITFALL", detail: "Cannot find module", evidence: 2 })),
    ).toBe('`pnpm build` has failed with: "Cannot find module" (2 runs)');
  });
});

describe("memory experiment", () => {
  const sample = (contextTokens: number, readFiles: number, turns: number) => ({
    completed: true,
    contextTokens,
    readFiles,
    turns,
  });

  it("compares new sessions with and without memory", () => {
    const withMemory = Array.from({ length: 12 }, (_, index) => sample(8_000 + index, 3, 4));
    const without = Array.from({ length: 12 }, (_, index) => sample(10_000 + index, 5, 6));
    const result = compareMemoryArms({ enabled: true, withMemory, without, windowDays: 90 });
    expect(result.state).toBe("SAVING");
    expect(result.readFilesChange).toBeCloseTo(-0.4);
    expect(result.turnsChange).toBeCloseTo(-1 / 3);
    expect(
      compareMemoryArms({ enabled: true, withMemory: [], without: [], windowDays: 90 }).state,
    ).toBe("COLLECTING");
    expect(
      compareMemoryArms({ enabled: false, withMemory: [], without: [], windowDays: 90 }).state,
    ).toBe("OFF");
  });

  it("draws an arm only for new sessions with the experiment on", () => {
    const base = { enabled: true, experiment: true, freshSession: true };
    expect(drawMemoryArm({ ...base, random: () => 0.2 })).toBe("NO_MEMORY");
    expect(drawMemoryArm({ ...base, random: () => 0.7 })).toBe("MEMORY");
    expect(drawMemoryArm({ ...base, freshSession: false, random: () => 0.2 })).toBeNull();
    expect(drawMemoryArm({ ...base, experiment: false, random: () => 0.2 })).toBeNull();
  });
});
