import { describe, expect, it } from "vitest";
import { composePrimer, composeUserMessage } from "../../src/domain/context-primer";
import { buildMcpConfig, ONYX_MCP_ALLOW_RULE } from "../../src/infrastructure/mcp-config";
import { ContextPolicy, PathGuard } from "@onyx/ignore-compiler";
import { RunTokenRegistry } from "../../src/infrastructure/run-tokens";

describe("composePrimer", () => {
  it("joins the workspace primer, agent prompt, project map and tool guide", () => {
    const primer = composePrimer({
      workspacePrimer: "Backend rules.",
      agentPrompt: "  ",
      projectName: "demo",
      map: { text: "src/\n  a.ts ~10", includedFiles: 1, omittedFiles: 3 },
      mcpEnabled: true,
    });
    expect(primer).toContain("Backend rules.\n\n## Onyx project map");
    expect(primer).toContain("demo: 1 files, 3 more not shown.");
    expect(primer).toContain("## Onyx context tools");
  });

  it("omits the map and tools when there is no index", () => {
    expect(
      composePrimer({
        workspacePrimer: null,
        agentPrompt: null,
        projectName: "demo",
        map: null,
        mcpEnabled: false,
      }),
    ).toBe("");
  });
});

describe("composeUserMessage", () => {
  it("places the context pack before the task", () => {
    expect(composeUserMessage("# Onyx context pack\nx", "Fix it")).toBe(
      "# Onyx context pack\nx\n\n---\n\n# Task\n\nFix it",
    );
    expect(composeUserMessage(null, "Fix it")).toBe("Fix it");
  });
});

describe("RunTokenRegistry", () => {
  it("issues one token per run, tracks usage and revokes it", () => {
    const registry = new RunTokenRegistry();
    const policy = new ContextPolicy([]);
    const scope = { workspaceId: null, policy, guard: new PathGuard(policy, "/tmp/project") };
    const first = registry.issue("run-1", "project-1", scope);
    const second = registry.issue("run-1", "project-1", scope);
    expect(first).not.toBe(second);
    expect(registry.resolve(first)).toBeNull();
    registry.record(second, 120);
    registry.record(second, 30);
    expect(registry.usage("run-1")).toEqual({ calls: 2, tokens: 150 });
    registry.revoke("run-1");
    expect(registry.resolve(second)).toBeNull();
    expect(registry.usage("run-1")).toEqual({ calls: 0, tokens: 0 });
  });
});

describe("buildMcpConfig", () => {
  it("launches the onyx server with the run credentials", () => {
    expect(
      buildMcpConfig({
        serverPath: "/opt/onyx/current/mcp/onyx-mcp.js",
        apiUrl: "http://127.0.0.1:4000",
        token: "secret",
        nodePath: "/usr/bin/node",
      }),
    ).toEqual({
      mcpServers: {
        onyx: {
          type: "stdio",
          command: "/usr/bin/node",
          args: ["/opt/onyx/current/mcp/onyx-mcp.js"],
          env: { ONYX_API_URL: "http://127.0.0.1:4000", ONYX_RUN_TOKEN: "secret" },
        },
      },
    });
    expect(ONYX_MCP_ALLOW_RULE).toBe("mcp__onyx");
  });
});
