import { describe, expect, it } from "vitest";
import { ContextPolicy, PathGuard, rule, SECURITY_RULES } from "../src";

const ROOT = "/srv/onyx/projects/shop";
const guard = new PathGuard(
  new ContextPolicy([rule("dist/"), rule("build/"), rule("*.log"), ...SECURITY_RULES]),
  ROOT,
  ["src/a.ts", "src/b.ts", "scripts/check.py", "dist/app.js", "build/out.js"],
  "/home/onyx",
);

function allowed(command: string): boolean {
  return guard.evaluateCommand(command, ROOT).allowed;
}

describe("PathGuard does not block ordinary commands", () => {
  it.each([
    'node -e "console.log(1)" && cat src/a.ts',
    "python3 scripts/check.py --out dist/report.json; ls",
    "echo `date` > build.log && cat src/a.ts",
    "grep -C 2 build src",
    "grep -m 1 dist src/a.ts",
    "grep -e logs -e dist src",
    "rg -t ts dist src",
    "rg --glob '*.ts' build src",
    "find . -name '*.ts' -not -path './node_modules/*'",
    "find . -path ./dist -prune -o -name '*.ts' -print",
    "find -L src -type f",
    "tree -I node_modules",
    "tree -L 2 src",
    'bash -c "pnpm test"',
    "sh -c 'cat src/a.ts'",
    "python3 -c \"import json; print(json.dumps({'a': 1}))\"",
    "node -e \"require('fs').readFileSync('src/a.ts')\"",
    "echo $(git rev-parse HEAD)",
  ])("allows %s", (command) => {
    expect(allowed(command)).toBe(true);
  });
});

describe("PathGuard still blocks reads of excluded files", () => {
  it.each([
    "grep -f .env src",
    "grep --file=.env src",
    "grep -rn ERROR dist",
    "rg -t ts secret dist",
    "find dist -name '*.js'",
    "tree dist",
    "bash -c 'cat .env'",
    'sh -c "head -n 1 dist/app.js"',
    "eval 'cat .env'",
    "echo $(cat .env)",
    "echo `cat dist/app.js`",
    "python3 -c \"print(open('.env').read())\"",
    "node -e \"require('fs').readFileSync('.env')\"",
    "perl -e \"open(F, '.env')\"",
    "echo .env | xargs cat",
    "bash -c \"bash -c 'cat .env'\"",
  ])("denies %s", (command) => {
    expect(allowed(command)).toBe(false);
  });
});
