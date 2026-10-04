import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectDetailDto } from "@onyx/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiClient,
  authenticate,
  createTestContext,
  destroyTestContext,
  type TestContext,
} from "../helpers";

let context: TestContext;
let project: ProjectDetailDto;

const FILES: Record<string, string> = {
  "src/a.ts": 'import { b } from "./b";\nexport const a = b + 1;\n',
  "src/b.ts": 'import { c } from "./c";\nexport const b = c + 1;\n',
  "src/c.ts": "export const c = 1;\n",
};

async function edges(): Promise<Map<string, string>> {
  const rows = await context.container.prisma.dependencyEdge.findMany({
    where: { projectId: project.id },
    select: { id: true, specifier: true, from: { select: { relPath: true } } },
  });
  return new Map(rows.map((row) => [`${row.from.relPath}->${row.specifier}`, row.id]));
}

async function reindex(): Promise<void> {
  await context.container.indexes.start(project.id);
  await context.container.indexes.idle(project.id);
}

beforeAll(async () => {
  context = await createTestContext({ projectFiles: FILES });
  const api = apiClient(context.app, await authenticate(context.app));
  project = (
    await api.post<ProjectDetailDto>("/api/projects", {
      name: "incremental",
      rootPath: context.projectRoot,
    })
  ).body;
  await context.container.indexes.idle(project.id);
});

afterAll(async () => {
  await destroyTestContext(context);
});

describe("saving the project index (A13)", () => {
  it("keeps what did not change and replaces only the edges of changed files", async () => {
    const before = await edges();
    expect([...before.keys()].sort()).toEqual(["src/a.ts->./b", "src/b.ts->./c"]);
    await reindex();
    expect(await edges()).toEqual(before);
    writeFileSync(
      join(context.projectRoot, "src/a.ts"),
      'import { c } from "./c";\nexport const a = c;\n',
    );
    await reindex();
    const after = await edges();
    expect([...after.keys()].sort()).toEqual(["src/a.ts->./c", "src/b.ts->./c"]);
    expect(after.get("src/b.ts->./c")).toBe(before.get("src/b.ts->./c"));
  });
});
