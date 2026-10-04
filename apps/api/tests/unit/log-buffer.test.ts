import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  LogBuffer,
  isQuietRequest,
  levelOf,
  MAX_LOG_TEXT,
} from "../../src/infrastructure/log-buffer";
import { createLogger } from "../../src/logger";

const TOKEN = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";

function line(record: Record<string, unknown>): string {
  return `${JSON.stringify({ level: 30, time: Date.parse("2026-10-04T10:00:00Z"), ...record })}\n`;
}

function sink(): { stream: Writable; lines: string[] } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { stream, lines };
}

describe("log levels", () => {
  it("maps pino numbers and names", () => {
    expect(levelOf(10)).toBe("trace");
    expect(levelOf(35)).toBe("info");
    expect(levelOf(50)).toBe("error");
    expect(levelOf(70)).toBe("fatal");
    expect(levelOf("warn")).toBe("warn");
    expect(levelOf("bogus")).toBe("info");
    expect(levelOf(undefined)).toBe("info");
  });
});

describe("log buffer", () => {
  it("keeps only the newest lines up to its capacity", () => {
    const buffer = new LogBuffer(3);
    for (let index = 1; index <= 5; index += 1) buffer.ingest(line({ msg: `line ${index}` }));
    const result = buffer.query({ limit: 10 });
    expect(result.entries.map((entry) => entry.msg)).toEqual(["line 5", "line 4", "line 3"]);
    expect(result).toMatchObject({ buffered: 3, capacity: 3, matched: 3 });
    expect(result.entries[0]?.seq).toBe(5);
  });

  it("filters by minimum level, run, text and limit", () => {
    const buffer = new LogBuffer(50);
    buffer.ingest(line({ level: 20, msg: "debug detail" }));
    buffer.ingest(line({ level: 30, msg: "Run started", runId: "run-a" }));
    buffer.ingest(line({ level: 40, msg: "Slow git status", runId: "run-a", path: "/srv/app" }));
    buffer.ingest(line({ level: 50, msg: "Run failed", runId: "run-b", err: { message: "boom" } }));
    buffer.ingest(line({ level: 60, msg: "Fatal stop" }));

    expect(buffer.query({ level: "warn", limit: 10 }).entries.map((entry) => entry.msg)).toEqual([
      "Fatal stop",
      "Run failed",
      "Slow git status",
    ]);
    expect(buffer.query({ runId: "run-a", limit: 10 }).entries.map((entry) => entry.msg)).toEqual([
      "Slow git status",
      "Run started",
    ]);
    expect(buffer.query({ q: "BOOM", limit: 10 }).entries.map((entry) => entry.msg)).toEqual([
      "Run failed",
    ]);
    expect(buffer.query({ q: "/srv/app", limit: 10 }).entries).toHaveLength(1);
    const limited = buffer.query({ limit: 2 });
    expect(limited.entries).toHaveLength(2);
    expect(limited.matched).toBe(5);
    expect(limited.runIds).toEqual(["run-b", "run-a"]);
  });

  it("keeps structured fields as context without the pino header", () => {
    const buffer = new LogBuffer(5);
    buffer.ingest(line({ msg: "Indexed", pid: 1, hostname: "h", projectId: "p1", files: 3 }));
    const [entry] = buffer.query({ limit: 1 }).entries;
    expect(entry).toMatchObject({
      level: "info",
      msg: "Indexed",
      runId: null,
      time: "2026-10-04T10:00:00.000Z",
      context: { projectId: "p1", files: 3 },
    });
    expect(entry?.context).not.toHaveProperty("pid");
  });

  it("redacts secrets before storing and before writing", () => {
    const buffer = new LogBuffer(5);
    const written = buffer.ingest(
      line({
        msg: `push failed for https://x:${TOKEN}@github.com/a/b`,
        req: { headers: { authorization: "Bearer abcdef123", cookie: "onyx_sid=zz" } },
        token: "plain-token-value",
      }),
    );
    const stored = JSON.stringify(buffer.query({ limit: 1 }));
    for (const text of [written, stored]) {
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("abcdef123");
      expect(text).not.toContain("onyx_sid=zz");
      expect(text).not.toContain("plain-token-value");
    }
    expect(written.endsWith("\n")).toBe(true);
  });

  it("skips successful request lines but keeps failed ones", () => {
    expect(isQuietRequest({ msg: "request completed", res: { statusCode: 200 } })).toBe(true);
    expect(isQuietRequest({ msg: "request completed", res: { statusCode: 500 } })).toBe(false);
    const buffer = new LogBuffer(5);
    buffer.ingest(line({ msg: "incoming request" }));
    buffer.ingest(line({ msg: "request completed", res: { statusCode: 404 } }));
    expect(buffer.query({ limit: 5 }).entries.map((entry) => entry.msg)).toEqual([
      "request completed",
    ]);
  });

  it("clips very long values and accepts lines that are not JSON", () => {
    const buffer = new LogBuffer(5);
    buffer.ingest(line({ msg: "x".repeat(MAX_LOG_TEXT + 50) }));
    buffer.ingest(`plain text with ${TOKEN}\n`);
    const [plain, long] = buffer.query({ limit: 5 }).entries;
    expect(long?.msg.length).toBe(MAX_LOG_TEXT + 1);
    expect(plain?.msg).toBe("plain text with [redacted]");
  });

  it("clears every line", () => {
    const buffer = new LogBuffer(5);
    buffer.ingest(line({ msg: "one" }));
    buffer.clear();
    expect(buffer.query({ limit: 5 })).toMatchObject({ entries: [], buffered: 0 });
  });
});

describe("logger tee", () => {
  it("copies every line into the buffer and writes the redacted line", () => {
    const buffer = new LogBuffer(10);
    const output = sink();
    const logger = createLogger(
      { env: "production", logLevel: "info" },
      { buffer, destination: output.stream },
    );
    logger.info({ runId: "run-1", apiKey: "k-123" }, `started with ${TOKEN}`);
    logger.debug("hidden by level");
    logger.error({ err: new Error(`clone failed: ${TOKEN}`) }, "Clone failed");

    const entries = buffer.query({ limit: 10 }).entries;
    expect(entries.map((entry) => entry.msg)).toEqual(["Clone failed", "started with [redacted]"]);
    expect(entries[1]?.runId).toBe("run-1");
    const written = output.lines.join("");
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain("k-123");
    expect(JSON.stringify(entries)).not.toContain(TOKEN);
  });
});
