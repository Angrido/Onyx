import { describe, expect, it } from "vitest";
import { WriteFence } from "../src";

const ROOT = "/srv/onyx/projects/shop";
const fence = new WriteFence(ROOT, { name: "Frontend", globs: ["apps/web/**", "packages/ui/**"] }, [
  { name: "Backend", globs: ["apps/api/**"] },
  { name: "Database", globs: ["packages/db/**", "**/prisma/**"] },
]);
const files = [
  "apps/web/app/page.tsx",
  "apps/web/components/button.tsx",
  "apps/api/src/server.ts",
  "apps/api/src/routes/login.ts",
  "apps/api/prisma/schema.prisma",
  "packages/db/src/client.ts",
  "packages/contracts/src/index.ts",
  "README.md",
];

function call(toolName: string, toolInput: Record<string, unknown>, cwd = ROOT) {
  return fence.evaluate({ toolName, toolInput, cwd });
}

describe("WriteFence outside the project", () => {
  it("leaves files in the home directory alone", () => {
    expect(call("Bash", { command: "mkdir -p ~/.cache/prisma/engines" }).allowed).toBe(true);
    expect(
      call("Write", { file_path: "~/.config/tool/prisma/x.json", content: "{}" }).allowed,
    ).toBe(true);
    expect(call("Bash", { command: "touch ~other/prisma/x" }).allowed).toBe(true);
  });
});

describe("WriteFence", () => {
  it("lets a workspace change its own and shared files only", () => {
    expect(fence.verdict("apps/web/app/page.tsx")).toEqual({ allowed: true, owner: "Frontend" });
    expect(fence.verdict("packages/contracts/src/index.ts")).toEqual({
      allowed: true,
      owner: null,
    });
    expect(fence.verdict("apps/api/src/server.ts")).toEqual({ allowed: false, owner: "Backend" });
    expect(fence.verdict("apps/api/prisma/schema.prisma")).toEqual({
      allowed: false,
      owner: "Backend",
    });
  });

  it("collapses only directories another workspace owns entirely", () => {
    expect(fence.compile(["packages/db/prisma/schema.prisma", "apps/api/prisma/x.prisma"])).toEqual(
      {
        editDeny: [
          `Edit(//${ROOT.slice(1)}/apps/api/**)`,
          `Edit(//${ROOT.slice(1)}/packages/db/**)`,
        ],
        truncated: false,
      },
    );
    const nested = new WriteFence(ROOT, { name: "Frontend", globs: ["apps/web/**"] }, [
      { name: "Database", globs: ["**/prisma/**"] },
    ]);
    expect(nested.compile(["db/prisma/schema.prisma", "db/seed.ts"]).editDeny).toEqual([
      `Edit(//${ROOT.slice(1)}/db/prisma/**)`,
    ]);
  });

  it("compiles collapsed Edit deny rules from the indexed files", () => {
    expect(fence.compile(files)).toEqual({
      editDeny: [`Edit(//${ROOT.slice(1)}/apps/api/**)`, `Edit(//${ROOT.slice(1)}/packages/db/**)`],
      truncated: false,
    });
  });

  it("blocks edit tools outside the fence with a helpful reason", () => {
    const denied = call("Edit", { file_path: `${ROOT}/apps/api/src/server.ts` });
    expect(denied).toMatchObject({ allowed: false, target: "apps/api/src/server.ts" });
    expect(denied.reason).toContain("belongs to the Backend workspace");
    expect(call("Write", { file_path: "apps/web/new.tsx" }).allowed).toBe(true);
    expect(call("NotebookEdit", { notebook_path: "packages/db/x.ipynb" }).allowed).toBe(false);
    expect(call("Read", { file_path: `${ROOT}/apps/api/src/server.ts` }).allowed).toBe(true);
    expect(call("Edit", { file_path: "/etc/hosts" }).allowed).toBe(true);
  });

  it.each([
    "echo hi > apps/api/src/x.ts",
    "cat a >> ../api/src/x.ts",
    "sed -i 's/a/b/' apps/api/src/server.ts",
    "rm -rf packages/db/src",
    "mv apps/api/src/server.ts apps/web/server.ts",
    "cp apps/web/a.ts apps/api/src/a.ts",
    "printf x | tee -a apps/api/src/log.ts",
    "cd apps/api && touch src/new.ts",
    "git checkout -- apps/api/src/server.ts",
    "chmod +x packages/db/scripts/run.sh",
  ])("blocks shell writes into another workspace: %s", (command) => {
    const cwd = command.startsWith("cat a") ? `${ROOT}/apps/web` : ROOT;
    expect(fence.evaluateCommand(command, cwd).allowed).toBe(false);
  });

  it.each([
    "cat apps/api/src/server.ts",
    "grep -rn login apps/api",
    "echo ok > /dev/null",
    "cp apps/api/src/server.ts apps/web/copy.ts",
    "sed -n 1,10p apps/api/src/server.ts",
    "pnpm --filter api test 2>&1",
    "touch packages/contracts/src/new.ts",
  ])("allows reads, shared files and own writes: %s", (command) => {
    expect(fence.evaluateCommand(command, ROOT).allowed).toBe(true);
  });
});
