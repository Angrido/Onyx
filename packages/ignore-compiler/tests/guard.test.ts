import { describe, expect, it } from "vitest";
import { ContextPolicy, globToRegExp, PathGuard, rule, SECURITY_RULES } from "../src";

const ROOT = "/srv/onyx/projects/demo";
const policy = new ContextPolicy([
  rule("dist/"),
  rule("*.log"),
  rule("fixtures/big.json"),
  ...SECURITY_RULES,
]);
const files = [
  "src/app.ts",
  "src/util.ts",
  "logs/a.log",
  "logs/b.log",
  "fixtures/big.json",
  "fixtures/small.json",
  ".env",
];
const guard = new PathGuard(policy, ROOT, files);

function call(toolName: string, toolInput: Record<string, unknown>, cwd = ROOT) {
  return guard.evaluate({ toolName, toolInput, cwd });
}

describe("PathGuard on file tools", () => {
  it("denies reads of excluded files with the matching rule", () => {
    const decision = call("Read", { file_path: `${ROOT}/dist/app.js` });
    expect(decision).toMatchObject({ allowed: false, target: "dist/app.js" });
    expect(decision.rule?.pattern).toBe("dist/");
    expect(decision.reason).toContain('rule "dist/"');
    expect(call("Read", { file_path: `${ROOT}/src/app.ts` }).allowed).toBe(true);
    expect(call("Read", { file_path: "/etc/hosts" }).allowed).toBe(true);
  });

  it("protects secrets whatever the relative path", () => {
    expect(call("Read", { file_path: ".env" }, `${ROOT}/src/..`).allowed).toBe(false);
    expect(call("Read", { file_path: "../.env" }, `${ROOT}/src`).allowed).toBe(false);
  });

  it("denies Grep, Glob and LS aimed at excluded areas but not broad searches", () => {
    expect(call("Grep", { pattern: "TODO", path: `${ROOT}/dist` }).allowed).toBe(false);
    expect(call("Glob", { pattern: "dist/**/*.js" }).allowed).toBe(false);
    expect(call("Glob", { pattern: "logs/*.log" }).allowed).toBe(false);
    expect(call("LS", { path: `${ROOT}/dist` }).allowed).toBe(false);
    expect(call("Grep", { pattern: "TODO", path: ROOT }).allowed).toBe(true);
    expect(call("Glob", { pattern: "**/*" }).allowed).toBe(true);
    expect(call("Glob", { pattern: "fixtures/*.json" }).allowed).toBe(true);
  });

  it("denies searches of directories whose known files are all excluded", () => {
    const decision = call("Grep", { pattern: "ERROR", path: "logs" });
    expect(decision).toMatchObject({ allowed: false, target: "logs" });
    expect(decision.rule?.pattern).toBe("*.log");
    expect(guard.evaluateCommand("grep -rn ERROR logs", ROOT).allowed).toBe(false);
    expect(call("Grep", { pattern: "x", path: `${ROOT}/fixtures` }).allowed).toBe(true);
    expect(call("Grep", { pattern: "x", path: `${ROOT}/src` }).allowed).toBe(true);
    expect(call("Grep", { pattern: "x", path: `${ROOT}/missing` }).allowed).toBe(true);
  });
});

describe("PathGuard on shell commands", () => {
  it.each([
    "cat dist/app.js",
    "head -n 20 logs/a.log",
    "tail -f logs/a.log | grep ERROR",
    "grep -rn TODO dist/",
    "rg secret dist",
    "sed -n 1,20p fixtures/big.json",
    "awk '{print $1}' logs/b.log",
    "git show HEAD:fixtures/big.json",
    "cp .env /tmp/leak",
    "cat < .env",
    "cat logs/*.log",
    "echo $(cat .env)",
    'bash -c "cat dist/app.js"',
    "cd src && cat ../.env",
  ])("denies %s", (command) => {
    expect(call("Bash", { command }).allowed).toBe(false);
  });

  it.each([
    "pnpm test",
    "cat src/app.ts",
    "grep -rn dist src/",
    "ls",
    "git diff",
    "cp src/app.ts dist/app.ts",
    "echo hello > out.log",
    "cat fixtures/small.json",
    "ls ~/.cache/ms-playwright",
    "ls -a ~/.cache/",
    "cat ~other/notes.log",
  ])("allows %s", (command) => {
    expect(call("Bash", { command }).allowed).toBe(true);
  });

  it("expands ~ to the home directory before matching", () => {
    const inHome = new PathGuard(policy, ROOT, files, "/srv/onyx/projects");
    expect(
      inHome.evaluate({ toolName: "Bash", toolInput: { command: "cat ~/demo/.env" }, cwd: ROOT })
        .allowed,
    ).toBe(false);
    expect(
      inHome.evaluate({
        toolName: "Read",
        toolInput: { file_path: "~/demo/dist/app.js" },
        cwd: ROOT,
      }).allowed,
    ).toBe(false);
    expect(
      inHome.evaluate({ toolName: "Bash", toolInput: { command: "ls ~/.cache" }, cwd: ROOT })
        .allowed,
    ).toBe(true);
  });
});

describe("globToRegExp", () => {
  it.each([
    ["**/*.ts", "a/b/c.ts", true],
    ["**/*.ts", "c.ts", true],
    ["src/*.ts", "src/a/b.ts", false],
    ["src/{a,b}.ts", "src/b.ts", true],
    ["file?.md", "file1.md", true],
  ])("%s matches %s → %s", (glob, path, expected) => {
    expect(globToRegExp(glob).test(path)).toBe(expected);
  });
});

describe("PathGuard with re-included files", () => {
  const reincluded = new ContextPolicy([
    rule("**/dist/**"),
    rule("dist/keep.js", { action: "INCLUDE" }),
  ]);
  const scoped = new PathGuard(reincluded, ROOT, ["dist/keep.js", "dist/bundle.js"]);

  it("allows files re-included inside an excluded directory", () => {
    expect(
      scoped.evaluate({ toolName: "Read", toolInput: { file_path: "dist/keep.js" }, cwd: ROOT })
        .allowed,
    ).toBe(true);
    expect(
      scoped.evaluate({ toolName: "Read", toolInput: { file_path: "dist/bundle.js" }, cwd: ROOT })
        .allowed,
    ).toBe(false);
    expect(
      scoped.evaluate({ toolName: "LS", toolInput: { path: `${ROOT}/dist` }, cwd: ROOT }).allowed,
    ).toBe(false);
  });
});
