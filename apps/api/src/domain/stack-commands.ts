import { tx } from "../i18n";

export type Stack = "node" | "python" | "go" | "rust" | "make" | "docker";

export interface StackFacts {
  files: ReadonlySet<string>;
  packageJson: Record<string, unknown> | null;
  makeTargets: readonly string[];
  pyproject: string | null;
}

export interface StackCommand {
  rule: string;
  command: string;
  reason: string;
  risky: boolean;
}

export interface StackReport {
  stacks: Stack[];
  packageManager: string | null;
  commands: StackCommand[];
}

const NODE_SCRIPTS = [
  "build",
  "typecheck",
  "type-check",
  "check-types",
  "check",
  "lint",
  "lint:fix",
  "format",
  "format:check",
  "test",
  "test:unit",
  "test:e2e",
];
const MAKE_TARGETS = ["build", "test", "lint", "check", "fmt", "format", "typecheck"];

function rule(command: string): string {
  return `Bash(${command} *)`;
}

function command(text: string, reason: string, risky = false): StackCommand {
  return { rule: rule(text), command: text, reason, risky };
}

function packageManagerOf(files: ReadonlySet<string>): string {
  if (files.has("pnpm-lock.yaml")) return "pnpm";
  if (files.has("yarn.lock")) return "yarn";
  if (files.has("bun.lockb") || files.has("bun.lock")) return "bun";
  return "npm";
}

function scriptsOf(packageJson: Record<string, unknown> | null): string[] {
  const scripts = packageJson?.["scripts"];
  if (typeof scripts !== "object" || scripts === null) return [];
  return Object.keys(scripts);
}

function hasDependency(packageJson: Record<string, unknown> | null, name: string): boolean {
  for (const key of ["dependencies", "devDependencies"]) {
    const group = packageJson?.[key];
    if (typeof group === "object" && group !== null && name in group) return true;
  }
  return false;
}

function nodeCommands(facts: StackFacts, manager: string): StackCommand[] {
  const commands: StackCommand[] = [
    command(
      `${manager} install`,
      tx("Installs the dependencies; it can run the packages' install scripts"),
      true,
    ),
  ];
  const scripts = scriptsOf(facts.packageJson);
  for (const script of NODE_SCRIPTS.filter((name) => scripts.includes(name)))
    commands.push(
      command(`${manager} run ${script}`, tx('The "{script}" script of package.json', { script })),
    );
  if (hasDependency(facts.packageJson, "typescript"))
    commands.push(
      command(
        manager === "npm" ? "npx tsc" : `${manager} exec tsc`,
        tx("The TypeScript compiler of the project"),
      ),
    );
  return commands;
}

function pythonCommands(facts: StackFacts): StackCommand[] {
  const commands: StackCommand[] = [];
  const pyproject = facts.pyproject ?? "";
  const usesPoetry = facts.files.has("poetry.lock") || /\[tool\.poetry\]/.test(pyproject);
  const usesUv = facts.files.has("uv.lock");
  const runner = usesPoetry ? "poetry run " : usesUv ? "uv run " : "";
  commands.push(command(`${runner}pytest`, tx("Runs the Python tests")));
  commands.push(
    command(`${runner}python -m pytest`, tx("Runs the Python tests through the module")),
  );
  if (/\bruff\b/.test(pyproject) || facts.files.has("ruff.toml"))
    commands.push(command(`${runner}ruff check`, tx("The Ruff linter configured in the project")));
  if (/\bmypy\b/.test(pyproject) || facts.files.has("mypy.ini"))
    commands.push(command(`${runner}mypy`, tx("The mypy type checker configured in the project")));
  if (usesPoetry)
    commands.push(command("poetry install", tx("Installs the dependencies with Poetry"), true));
  else if (usesUv) commands.push(command("uv sync", tx("Installs the dependencies with uv"), true));
  else if (facts.files.has("requirements.txt"))
    commands.push(
      command(
        "pip install -r requirements.txt",
        tx("Installs the dependencies listed in requirements.txt"),
        true,
      ),
    );
  return commands;
}

export function detectStack(facts: StackFacts): StackReport {
  const stacks: Stack[] = [];
  const commands: StackCommand[] = [];
  let packageManager: string | null = null;
  if (facts.files.has("package.json")) {
    stacks.push("node");
    packageManager = packageManagerOf(facts.files);
    commands.push(...nodeCommands(facts, packageManager));
  }
  if (
    facts.files.has("pyproject.toml") ||
    facts.files.has("requirements.txt") ||
    facts.files.has("setup.py")
  ) {
    stacks.push("python");
    commands.push(...pythonCommands(facts));
  }
  if (facts.files.has("go.mod")) {
    stacks.push("go");
    commands.push(
      command("go test", tx("Runs the Go tests")),
      command("go build", tx("Builds the Go packages")),
      command("go vet", tx("Reports suspicious Go code")),
      command("gofmt -l", tx("Lists Go files that are not formatted")),
    );
  }
  if (facts.files.has("Cargo.toml")) {
    stacks.push("rust");
    commands.push(
      command("cargo test", tx("Runs the Rust tests")),
      command("cargo check", tx("Type-checks the Rust crate")),
      command("cargo build", tx("Builds the Rust crate")),
      command("cargo clippy", tx("The Rust linter")),
      command("cargo fmt --check", tx("Checks the Rust formatting")),
    );
  }
  if (facts.files.has("Makefile")) {
    stacks.push("make");
    for (const target of MAKE_TARGETS.filter((name) => facts.makeTargets.includes(name)))
      commands.push(
        command(`make ${target}`, tx('The "{target}" target of the Makefile', { target })),
      );
  }
  if (
    facts.files.has("Dockerfile") ||
    [...facts.files].some((file) => /^docker-compose.*\.ya?ml$|^compose\.ya?ml$/.test(file))
  ) {
    stacks.push("docker");
    commands.push(
      command(
        "docker build",
        tx("Builds the project image; it can run any command of the Dockerfile"),
        true,
      ),
    );
  }
  const unique = new Map(commands.map((entry) => [entry.rule, entry]));
  return { stacks, packageManager, commands: [...unique.values()] };
}

export function makeTargetsOf(makefile: string): string[] {
  const targets = new Set<string>();
  for (const line of makefile.split("\n")) {
    const match = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(line);
    if (match?.[1] && !match[1].startsWith(".")) targets.add(match[1]);
  }
  return [...targets];
}
