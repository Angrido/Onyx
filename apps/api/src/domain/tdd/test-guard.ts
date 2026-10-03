import {
  permissionPaths,
  WriteFence,
  type GuardDecision,
  type ToolCall,
} from "@onyx/ignore-compiler";
import picomatch from "picomatch";
import {
  isTestCommand,
  PROTECTED_FILE_REASON,
  PROTECTED_TEST_GLOBS,
  TEST_COMMAND_DENY_RULES,
  TEST_COMMAND_REASON,
} from "./runners";

export type TestGuardDecision = GuardDecision & { violation: "test-file" | "test-command" | null };

export class TestGuard {
  private readonly fence: WriteFence;
  private readonly matcher: (path: string) => boolean;

  constructor(
    private readonly projectRoot: string,
    private readonly globs: readonly string[] = PROTECTED_TEST_GLOBS,
  ) {
    this.matcher = picomatch([...globs], { dot: true });
    this.fence = new WriteFence(
      projectRoot,
      { name: "TDD loop", globs: [] },
      [{ name: "tests", globs }],
      ({ relPath }) => PROTECTED_FILE_REASON(relPath),
    );
  }

  isProtected(relPath: string): boolean {
    return this.matcher(relPath);
  }

  evaluate(call: ToolCall): TestGuardDecision {
    if (call.toolName === "Bash" && typeof call.toolInput === "object" && call.toolInput !== null) {
      const command = (call.toolInput as Record<string, unknown>)["command"];
      if (typeof command === "string" && isTestCommand(command)) {
        return {
          allowed: false,
          target: command.slice(0, 200),
          rule: null,
          reason: TEST_COMMAND_REASON,
          violation: "test-command",
        };
      }
    }
    const decision = this.fence.evaluate(call);
    return { ...decision, violation: decision.allowed ? null : "test-file" };
  }

  denyRules(): string[] {
    const edits = this.globs.flatMap((glob) =>
      permissionPaths(`/${glob}`, this.projectRoot).map((path) => `Edit(${path})`),
    );
    return [...new Set([...edits, ...TEST_COMMAND_DENY_RULES])];
  }
}
