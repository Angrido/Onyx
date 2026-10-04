import { describe, expect, it } from "vitest";
import { RunRecorder } from "../../src/application/run-recorder";
import type { AgentEventRow, EventWriter } from "../../src/infrastructure/event-writer";
import type { RunEventPublisher } from "../../src/infrastructure/ws-hub";

function recorder() {
  const rows: AgentEventRow[] = [];
  const writer = { enqueue: (row: AgentEventRow) => rows.push(row) } as unknown as EventWriter;
  const publisher: RunEventPublisher = {
    publishRunEvent: () => undefined,
    publishRunDelta: () => undefined,
  };
  return { rows, recorder: new RunRecorder("run-1", writer, publisher) };
}

function toolUse(name: string, input: Record<string, unknown>) {
  return {
    type: "assistant",
    message: {
      id: `msg-${name}`,
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "tool_use", id: `tool-${name}`, name, input }],
    },
  };
}

describe("run recorder", () => {
  it("knows whether a run may have written files (A13)", () => {
    const reading = recorder();
    reading.recorder.recordClaudeEvent(toolUse("Read", { file_path: "a.ts" }));
    reading.recorder.recordClaudeEvent(toolUse("Grep", { pattern: "x" }));
    expect(reading.recorder.mayHaveWritten).toBe(false);
    const writing = recorder();
    writing.recorder.recordClaudeEvent(toolUse("Bash", { command: "pnpm test" }));
    expect(writing.recorder.mayHaveWritten).toBe(true);
  });

  it("stores the normalized items with Claude's events but not with Onyx's own (M23)", () => {
    const { rows, recorder: run } = recorder();
    run.recordClaudeEvent(toolUse("Read", { file_path: "a.ts" }));
    run.recordOnyx({ kind: "stderr", text: "warning" });
    expect(rows[0]?.items).toMatchObject([{ kind: "tool_use", name: "Read" }]);
    expect(rows[1]?.items).toBeUndefined();
  });
});
