import { describe, expect, it } from "vitest";
import type { ImportRef } from "@onyx/lean-ctx";
import { ModuleResolver } from "../src";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "root", private: true }),
  "tsconfig.json": '{ // comment\n  "extends": "@acme/config/tsconfig/base.json",\n}',
  "packages/config/package.json": JSON.stringify({ name: "@acme/config" }),
  "packages/config/tsconfig/base.json": JSON.stringify({ compilerOptions: { strict: true } }),
  "packages/core/package.json": JSON.stringify({
    name: "@acme/core",
    exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./testing": "./src/testing.ts",
      "./features/*": "./src/features/*.ts",
    },
  }),
  "packages/core/src/index.ts": "",
  "packages/core/src/testing.ts": "",
  "packages/core/src/features/search.ts": "",
  "packages/legacy/package.json": JSON.stringify({ name: "legacy-lib", main: "lib/main.js" }),
  "packages/legacy/lib/main.js": "",
  "apps/web/tsconfig.json": JSON.stringify({
    extends: "../../tsconfig.json",
    compilerOptions: { baseUrl: ".", paths: { "@/*": ["./*"], "~config": ["./config/index.ts"] } },
  }),
  "apps/web/lib/utils.ts": "",
  "apps/web/config/index.ts": "",
  "apps/web/components/button.tsx": "",
  "apps/web/components/index.ts": "",
  "apps/web/app/page.tsx": "",
  "apps/api/src/server.ts": "",
  "apps/api/src/routes/index.ts": "",
  "apps/api/src/config.ts": "",
  "apps/api/src/data.json": "{}",
  "py/pyproject.toml": "",
  "py/src/billing/__init__.py": "",
  "py/src/billing/models.py": "",
  "py/src/billing/utils.py": "",
  "py/src/billing/api/views.py": "",
  "py/src/billing/api/__init__.py": "",
};

const resolver = new ModuleResolver(Object.keys(FILES), (path) => FILES[path] ?? null);

function ref(specifier: string, names: string[] = []): ImportRef {
  return { specifier, kind: "static", typeOnly: false, names, line: 1 };
}

function script(from: string, specifier: string) {
  return resolver.resolveScript(from, specifier);
}

describe("ModuleResolver for scripts", () => {
  it.each([
    ["apps/api/src/server.ts", "./config", "apps/api/src/config.ts"],
    ["apps/api/src/server.ts", "./config.js", "apps/api/src/config.ts"],
    ["apps/api/src/server.ts", "./routes", "apps/api/src/routes/index.ts"],
    ["apps/api/src/routes/index.ts", "../data.json", "apps/api/src/data.json"],
    ["apps/web/app/page.tsx", "@/lib/utils", "apps/web/lib/utils.ts"],
    ["apps/web/app/page.tsx", "@/components", "apps/web/components/index.ts"],
    ["apps/web/app/page.tsx", "@/components/button.js", "apps/web/components/button.tsx"],
    ["apps/web/app/page.tsx", "~config", "apps/web/config/index.ts"],
    ["apps/web/app/page.tsx", "@acme/core", "packages/core/src/index.ts"],
    ["apps/api/src/server.ts", "@acme/core/testing", "packages/core/src/testing.ts"],
    [
      "apps/api/src/server.ts",
      "@acme/core/features/search",
      "packages/core/src/features/search.ts",
    ],
    ["apps/api/src/server.ts", "legacy-lib", "packages/legacy/lib/main.js"],
    ["apps/api/src/server.ts", "./routes/index?raw", "apps/api/src/routes/index.ts"],
  ])("%s imports %s → %s", (from, specifier, target) => {
    expect(script(from, specifier)).toEqual({ kind: "internal", target });
  });

  it("classifies builtins and third-party packages as external", () => {
    expect(script("apps/api/src/server.ts", "node:fs/promises")).toEqual({
      kind: "external",
      module: "node:fs/promises",
    });
    expect(script("apps/api/src/server.ts", "path")).toEqual({
      kind: "external",
      module: "node:path",
    });
    expect(script("apps/api/src/server.ts", "@fastify/websocket/lib")).toEqual({
      kind: "external",
      module: "@fastify/websocket",
    });
    expect(script("apps/web/app/page.tsx", "react")).toEqual({ kind: "external", module: "react" });
  });

  it("leaves missing relative files and paths outside the project unresolved", () => {
    expect(script("apps/api/src/server.ts", "./missing")).toEqual({ kind: "unresolved" });
    expect(script("apps/api/src/server.ts", "../../../../outside")).toEqual({ kind: "unresolved" });
  });

  it("does not apply path aliases outside the tsconfig that declares them", () => {
    expect(script("apps/api/src/server.ts", "@/lib/utils")).toEqual({
      kind: "external",
      module: "@/lib",
    });
  });
});

describe("ModuleResolver for Python", () => {
  const from = "py/src/billing/api/views.py";

  it("resolves relative imports, preferring submodules named in the import", () => {
    expect(resolver.resolve(from, ref("..models", ["Customer"]), "python")).toEqual([
      { kind: "internal", target: "py/src/billing/models.py" },
    ]);
    expect(resolver.resolve(from, ref("..", ["utils", "models"]), "python")).toEqual([
      { kind: "internal", target: "py/src/billing/utils.py" },
      { kind: "internal", target: "py/src/billing/models.py" },
    ]);
    expect(resolver.resolve(from, ref(".", ["Missing"]), "python")).toEqual([
      { kind: "internal", target: "py/src/billing/api/__init__.py" },
    ]);
  });

  it("resolves absolute imports through detected source roots", () => {
    expect(resolver.resolve(from, ref("billing.models"), "python")).toEqual([
      { kind: "internal", target: "py/src/billing/models.py" },
    ]);
    expect(resolver.resolve(from, ref("billing"), "python")).toEqual([
      { kind: "internal", target: "py/src/billing/__init__.py" },
    ]);
  });

  it("treats unknown top-level modules as external packages", () => {
    expect(resolver.resolve(from, ref("requests.adapters"), "python")).toEqual([
      { kind: "external", module: "requests" },
    ]);
  });
});
