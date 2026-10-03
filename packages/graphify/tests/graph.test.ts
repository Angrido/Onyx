import { describe, expect, it } from "vitest";
import {
  blastRadii,
  DependencyGraph,
  dependencyCycles,
  DomainClassifier,
  effectiveDependencies,
  expandTargetPaths,
  heuristicDomain,
  inferTargets,
  neighborhood,
  pageRank,
  proposeDomainGlobs,
  type GraphEdge,
} from "../src";

function edge(
  from: string,
  to: string,
  names: string[] = [],
  kind: GraphEdge["kind"] = "STATIC_IMPORT",
): GraphEdge {
  return { from, to, external: null, kind, specifier: to, names };
}

const nodes = ["app.ts", "service.ts", "repo.ts", "db.ts", "util.ts", "a.ts", "b.ts", "c.ts"];
const graph = new DependencyGraph(nodes, [
  edge("app.ts", "service.ts"),
  edge("service.ts", "repo.ts"),
  edge("service.ts", "util.ts"),
  edge("repo.ts", "db.ts"),
  edge("repo.ts", "util.ts"),
  edge("a.ts", "b.ts"),
  edge("b.ts", "c.ts"),
  edge("c.ts", "a.ts"),
  edge("app.ts", "app.ts"),
  {
    from: "app.ts",
    to: null,
    external: "fastify",
    kind: "STATIC_IMPORT",
    specifier: "fastify",
    names: [],
  },
]);

describe("DependencyGraph", () => {
  it("indexes distinct internal neighbours and ignores self and external edges", () => {
    expect(graph.dependencies("service.ts").sort()).toEqual(["repo.ts", "util.ts"]);
    expect(graph.dependents("util.ts").sort()).toEqual(["repo.ts", "service.ts"]);
    expect(graph.outDegree("app.ts")).toBe(1);
    expect(graph.internalEdgeCount()).toBe(8);
  });
});

describe("metrics", () => {
  it("ranks widely imported files highest and keeps PageRank normalised", () => {
    const ranks = pageRank(graph);
    const total = [...ranks.values()].reduce((sum, rank) => sum + rank, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(ranks.get("util.ts") ?? 0).toBeGreaterThan(ranks.get("app.ts") ?? 0);
    expect(ranks.get("db.ts") ?? 0).toBeGreaterThan(ranks.get("app.ts") ?? 0);
  });

  it("finds dependency cycles with Tarjan", () => {
    expect(dependencyCycles(graph)).toEqual([["a.ts", "b.ts", "c.ts"]]);
  });

  it("computes blast radius as the number of transitive dependents", () => {
    const radii = blastRadii(graph);
    expect(radii?.get("util.ts")).toBe(3);
    expect(radii?.get("db.ts")).toBe(3);
    expect(radii?.get("app.ts")).toBe(0);
    expect(radii?.get("a.ts")).toBe(2);
  });

  it("walks neighbourhoods by direction and depth", () => {
    expect(Object.fromEntries(neighborhood(graph, ["service.ts"], 1))).toEqual({
      "service.ts": 0,
      "repo.ts": 1,
      "util.ts": 1,
      "app.ts": 1,
    });
    expect([...neighborhood(graph, ["service.ts"], 2, "out").keys()].sort()).toEqual([
      "db.ts",
      "repo.ts",
      "service.ts",
      "util.ts",
    ]);
  });
});

describe("barrels", () => {
  const barrelGraph = new DependencyGraph(
    ["main.ts", "index.ts", "types.ts", "impl.ts", "nested/index.ts", "nested/deep.ts"],
    [
      edge("main.ts", "index.ts", ["Config", "run", "deep", "missing"]),
      edge("index.ts", "types.ts", ["*"], "REEXPORT"),
      edge("index.ts", "impl.ts", ["run"], "REEXPORT"),
      edge("index.ts", "nested/index.ts", ["*"], "REEXPORT"),
      edge("nested/index.ts", "nested/deep.ts", ["*"], "REEXPORT"),
    ],
  );
  const exportsOf = (path: string) =>
    ({ "types.ts": ["Config"], "impl.ts": ["run", "helper"], "nested/deep.ts": ["deep"] })[path];

  it("follows re-exports to the modules that declare the imported names", () => {
    const resolved = effectiveDependencies(barrelGraph, exportsOf, "main.ts");
    expect(resolved).toEqual([
      { relPath: "types.ts", names: ["Config"], typeOnly: false },
      { relPath: "impl.ts", names: ["run"], typeOnly: false },
      { relPath: "nested/deep.ts", names: ["deep"], typeOnly: false },
      { relPath: "index.ts", names: ["missing"], typeOnly: false },
    ]);
  });
});

describe("domains", () => {
  it("prefers workspace globs over heuristics", () => {
    const classifier = new DomainClassifier([
      { workspaceId: "ws-web", domain: "FRONTEND", globs: ["apps/web/**"] },
      { workspaceId: "ws-db", domain: "DATABASE", globs: ["packages/db/**"] },
    ]);
    expect(classifier.classify("apps/web/lib/api.ts")).toEqual({
      domain: "FRONTEND",
      workspaceId: "ws-web",
    });
    expect(classifier.classify("packages/db/src/client.ts")).toEqual({
      domain: "DATABASE",
      workspaceId: "ws-db",
    });
    expect(classifier.classify("deploy/scripts/build.sh")).toEqual({
      domain: "INFRA",
      workspaceId: null,
    });
    expect(classifier.classify("packages/shared/src/math.ts")).toBeNull();
  });

  it.each([
    ["apps/api/src/routes/users.ts", "BACKEND"],
    ["src/components/Button.tsx", "FRONTEND"],
    ["prisma/schema.prisma", "DATABASE"],
    [".github/workflows/ci.yml", "INFRA"],
    ["service/handlers.py", "BACKEND"],
  ])("heuristic domain of %s is %s", (path, domain) => {
    expect(heuristicDomain(path)).toBe(domain);
  });

  it("proposes workspace globs from directory clusters", () => {
    const proposal = proposeDomainGlobs([
      { relPath: "apps/web/a.tsx", domain: "FRONTEND" },
      { relPath: "apps/web/b.tsx", domain: "FRONTEND" },
      { relPath: "apps/web/c.ts", domain: null },
      { relPath: "apps/api/x.ts", domain: "BACKEND" },
      { relPath: "deploy/run.sh", domain: "INFRA" },
    ]);
    expect(proposal).toEqual({
      FRONTEND: ["apps/web/**"],
      BACKEND: ["apps/api/**"],
      INFRA: ["deploy/**"],
    });
  });
});

describe("targets", () => {
  const files = [
    "apps/api/src/application/run-executor.ts",
    "apps/api/src/config.ts",
    "apps/web/lib/config.ts",
    "packages/db/src/client.ts",
  ];
  const symbolFiles = new Map([
    ["RunExecutor", ["apps/api/src/application/run-executor.ts"]],
    ["loadConfig", ["apps/api/src/config.ts", "apps/web/lib/config.ts"]],
  ]);

  it("infers targets from unambiguous paths and backticked symbols", () => {
    const prompt =
      "Fix the retry in `RunExecutor`, see packages/db/src/client.ts and config.ts; also `loadConfig()`.";
    expect(inferTargets({ prompt, files, symbolFiles })).toEqual([
      "packages/db/src/client.ts",
      "apps/api/src/application/run-executor.ts",
    ]);
  });

  it("expands directories to their most central files", () => {
    const rank = new Map([["apps/api/src/config.ts", 0.9]]);
    expect(
      expandTargetPaths(["./apps/api/", "packages/db/src/client.ts", "nope"], files, rank),
    ).toEqual([
      "apps/api/src/config.ts",
      "apps/api/src/application/run-executor.ts",
      "packages/db/src/client.ts",
    ]);
  });
});
