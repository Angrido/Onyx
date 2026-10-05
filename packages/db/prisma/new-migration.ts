import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanDiff, MIGRATION_NAME, nextMigrationName } from "./migration-names";

const packageDir = fileURLToPath(new URL("..", import.meta.url));

function option(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

function main(argv: string[]): number {
  const args = argv.filter((arg) => arg !== "--");
  const label = args.find(
    (arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"),
  );
  if (!label) {
    process.stderr.write(
      "usage: pnpm --filter @onyx/db migrate:new <name> [--migrations <dir>] [--schema <file>]\n",
    );
    return 2;
  }
  const migrationsDir = resolve(
    option(args, "--migrations") ?? join(packageDir, "prisma", "migrations"),
  );
  const schema = resolve(option(args, "--schema") ?? join(packageDir, "prisma", "schema.prisma"));
  const existing = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && MIGRATION_NAME.test(entry.name))
    .map((entry) => entry.name);
  const name = nextMigrationName(existing, label, new Date());
  const diff = spawnSync(
    join(packageDir, "node_modules", ".bin", "prisma"),
    [
      "migrate",
      "diff",
      "--from-migrations",
      migrationsDir,
      "--to-schema",
      schema,
      "--script",
      "--exit-code",
    ],
    { cwd: packageDir, encoding: "utf8" },
  );
  if (diff.status === 0) {
    process.stderr.write("The schema matches the migrations: there is nothing to migrate\n");
    return 1;
  }
  if (diff.status !== 2) {
    process.stderr.write(diff.stderr || diff.error?.message || "prisma migrate diff failed\n");
    return 1;
  }
  const sql = cleanDiff(diff.stdout);
  if (!sql) {
    process.stderr.write("prisma migrate diff produced no SQL: there is nothing to migrate\n");
    return 1;
  }
  const directory = join(migrationsDir, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "migration.sql"), `${sql}\n`);
  const file = join(directory, "migration.sql");
  const shown = relative(process.cwd(), file);
  process.stdout.write(`Created ${shown.startsWith("..") ? file : shown}\n`);
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
