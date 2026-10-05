import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WriteFence } from "../src";

let root: string;
let fence: WriteFence;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "onyx-fence-"));
  for (const path of [
    "apps/web/app/page.tsx",
    "apps/api/src/server.ts",
    "apps/api/src/auth.ts",
    "packages/ui/button.tsx",
    "README.md",
  ]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), "x");
  }
  fence = new WriteFence(root, { name: "Frontend", globs: ["apps/web/**", "packages/ui/**"] }, [
    { name: "Backend", globs: ["apps/api/**"] },
  ]);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function bash(command: string, cwd = root) {
  return fence.evaluate({ toolName: "Bash", toolInput: { command }, cwd });
}

describe("writes the audit found passing the fence (A8)", () => {
  it.each([
    "rm -rf apps",
    "rm -rf .",
    "rm apps/api/src/a*",
    "rm apps/*/src/server.ts",
    "find apps -delete",
    "find . -name '*.ts' -exec rm {} +",
    "cp -t apps/api/src new.ts",
    "cp --target-directory=apps/api/src new.ts",
    "cp new.ts apps/api/src",
    "tar -xf x.tgz -C apps/api",
    "tar czf apps/api/backup.tgz src",
    "unzip x.zip -d apps/api",
    "dd if=a of=apps/api/src/server.ts",
    "prettier --write apps",
    "eslint --fix apps/api",
    "git checkout .",
    "git restore .",
    "git clean -fd",
    "git -C apps checkout -- api",
    "git checkout main",
    "git reset --hard",
    "chmod -R 777 apps",
  ])("%s", (command) => {
    expect(bash(command).allowed).toBe(false);
  });

  it.each([
    "rm -rf apps/web/dist",
    "rm packages/ui/*.tsx",
    "cp new.ts apps/web/app",
    "prettier --write apps/web",
    "eslint --fix packages/ui",
    "find apps/web -name '*.tmp' -delete",
    "git restore apps/web/app/page.tsx",
    "tar czf out.tgz apps",
    "touch README.md",
  ])("lets %s through", (command) => {
    expect(bash(command)).toMatchObject({ allowed: true });
  });
});
