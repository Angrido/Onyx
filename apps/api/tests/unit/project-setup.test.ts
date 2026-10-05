import { describe, expect, it } from "vitest";
import { detectStack, makeTargetsOf, type StackFacts } from "../../src/domain/stack-commands";
import { proposeWorkspaces, type ProjectLayout } from "../../src/domain/workspace-proposal";

function facts(overrides: Partial<StackFacts>): StackFacts {
  return { files: new Set(), packageJson: null, makeTargets: [], pyproject: null, ...overrides };
}

function layout(
  directories: string[],
  files: string[] = [],
  children: Record<string, string[]> = {},
): ProjectLayout {
  return { directories, files, children: new Map(Object.entries(children)) };
}

describe("commands for the project's stack", () => {
  it("proposes the pnpm scripts the project has and marks installs as risky", () => {
    const report = detectStack(
      facts({
        files: new Set(["package.json", "pnpm-lock.yaml"]),
        packageJson: {
          scripts: { build: "tsc", lint: "eslint .", dev: "vite", "test:unit": "vitest" },
          devDependencies: { typescript: "5" },
        },
      }),
    );
    expect(report.stacks).toEqual(["node"]);
    expect(report.packageManager).toBe("pnpm");
    expect(report.commands.map((entry) => [entry.rule, entry.risky])).toEqual([
      ["Bash(pnpm install *)", true],
      ["Bash(pnpm run build *)", false],
      ["Bash(pnpm run lint *)", false],
      ["Bash(pnpm run test:unit *)", false],
      ["Bash(pnpm exec tsc *)", false],
    ]);
  });

  it("covers Python with Poetry, Go, Rust, make and Docker without interpreters", () => {
    const report = detectStack(
      facts({
        files: new Set([
          "pyproject.toml",
          "poetry.lock",
          "go.mod",
          "Cargo.toml",
          "Makefile",
          "Dockerfile",
        ]),
        pyproject: "[tool.poetry]\n[tool.ruff]\n",
        makeTargets: ["test", "deploy", "lint"],
      }),
    );
    expect(report.stacks).toEqual(["python", "go", "rust", "make", "docker"]);
    const rules = report.commands.map((entry) => entry.rule);
    expect(rules).toEqual(
      expect.arrayContaining([
        "Bash(poetry run pytest *)",
        "Bash(poetry run ruff check *)",
        "Bash(go test *)",
        "Bash(cargo test *)",
        "Bash(make test *)",
        "Bash(make lint *)",
        "Bash(docker build *)",
      ]),
    );
    expect(rules).not.toContain("Bash(make deploy *)");
    expect(rules.some((rule) => /python -c|node -e|Bash\(python \*\)/.test(rule))).toBe(false);
    expect(report.commands.find((entry) => entry.rule === "Bash(docker build *)")?.risky).toBe(
      true,
    );
  });

  it("reads Makefile targets", () => {
    expect(makeTargetsOf("test: build\n\tgo test\nbuild:\n.PHONY: test\nX := 1\n")).toEqual([
      "test",
      "build",
    ]);
  });
});

describe("workspaces proposed from the project layout", () => {
  it("maps a monorepo's apps and packages to domains", () => {
    expect(
      proposeWorkspaces(
        layout(["apps", "packages", "deploy", ".github"], ["docker-compose.yml"], {
          apps: ["web", "api", "docs"],
          packages: ["db", "ui", "config"],
        }),
      ).map((entry) => [entry.name, entry.domain, entry.pathGlobs]),
    ).toEqual([
      ["Frontend", "FRONTEND", ["apps/web/**", "packages/ui/**"]],
      ["Backend", "BACKEND", ["apps/api/**"]],
      ["Database", "DATABASE", ["packages/db/**"]],
      ["Infra", "INFRA", [".github/**", "deploy/**", "docker-compose.yml"]],
    ]);
  });

  it("splits a single app by the folders inside src", () => {
    expect(
      proposeWorkspaces(
        layout(["src", "prisma", "public"], [], { src: ["components", "server", "lib"] }),
      ).map((entry) => [entry.name, entry.pathGlobs]),
    ).toEqual([
      ["Frontend", ["public/**", "src/components/**"]],
      ["Backend", ["src/server/**"]],
      ["Database", ["prisma/**"]],
    ]);
  });

  it("falls back to one core workspace when nothing is recognisable", () => {
    expect(
      proposeWorkspaces(layout(["src", "web"], [], { src: [] })).map((entry) => [
        entry.name,
        entry.pathGlobs,
      ]),
    ).toEqual([["Frontend", ["web/**"]]]);
    expect(
      proposeWorkspaces(layout(["src", "docs"], [], { src: [] })).map((entry) => [
        entry.name,
        entry.domain,
        entry.pathGlobs,
      ]),
    ).toEqual([["Core", "CUSTOM", ["src/**"]]]);
    expect(proposeWorkspaces(layout([], ["main.go"])).map((entry) => entry.pathGlobs)).toEqual([
      ["**"],
    ]);
  });
});
