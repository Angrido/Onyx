import { describe, expect, it } from "vitest";
import {
  ContextPolicy,
  DirectoryTracker,
  PathGuard,
  rule,
  SECURITY_RULES,
  separateLines,
  WriteFence,
} from "../src";

const ROOT = "/srv/onyx/projects/demo";
const HOME = "/home/onyx";
const guard = new PathGuard(
  new ContextPolicy([rule("private/"), ...SECURITY_RULES]),
  ROOT,
  ["src/app.ts", "private/notes.md"],
  HOME,
);
const fence = new WriteFence(ROOT, { name: "Frontend", globs: ["apps/web/**"] }, [
  { name: "Backend", globs: ["apps/api/**"] },
]);

function read(command: string): boolean {
  return guard.evaluateCommand(command, ROOT).allowed;
}

function write(command: string): boolean {
  return fence.evaluateCommand(command, ROOT).allowed;
}

describe("separateLines", () => {
  it("turns unquoted newlines into command separators", () => {
    expect(separateLines("echo hi\ncat .env")).toBe("echo hi;cat .env");
    expect(separateLines("echo hi\r\ncat .env")).toBe("echo hi;cat .env");
    expect(separateLines("echo 'a\nb'\ncat x")).toBe("echo 'a\nb';cat x");
    expect(separateLines('echo "a\nb"')).toBe('echo "a\nb"');
  });

  it("joins continued lines and drops here-document bodies", () => {
    expect(separateLines("cat \\\n.env")).toBe("cat .env");
    expect(separateLines("cat > out.txt <<'EOF'\nrm -rf dist\nEOF\nls")).toBe(
      "cat > out.txt <<'EOF';ls",
    );
    expect(separateLines("cat <<-END\n\tbody\n\tEND\npwd")).toBe("cat <<-END;pwd");
  });
});

describe("DirectoryTracker", () => {
  it("restores the directory when a subshell closes", () => {
    const tracker = new DirectoryTracker(ROOT, ROOT, HOME);
    tracker.open();
    tracker.enter(["cd", "/tmp"]);
    expect(tracker.candidates()).toEqual(["/tmp"]);
    tracker.close();
    expect(tracker.candidates()).toEqual([ROOT]);
  });

  it("follows pushd, popd and cd -", () => {
    const tracker = new DirectoryTracker(ROOT, ROOT, HOME);
    tracker.enter(["pushd", "/tmp"]);
    tracker.enter(["popd"]);
    expect(tracker.candidates()).toEqual([ROOT]);
    tracker.enter(["cd", "src"]);
    tracker.enter(["cd", "-"]);
    expect(tracker.candidates()).toEqual([ROOT]);
    tracker.enter(["cd"]);
    expect(tracker.candidates()).toEqual([HOME]);
  });

  it("keeps every possible directory when the target cannot be resolved", () => {
    const tracker = new DirectoryTracker(ROOT, ROOT, HOME);
    tracker.enter(["cd", "/tmp"]);
    tracker.enter(["cd", "$OLDPWD"]);
    expect(tracker.candidates()).toEqual(["/tmp", ROOT]);
  });
});

describe("PathGuard on multi-line and nested commands", () => {
  it("checks every line of a command", () => {
    expect(read("echo hi\ncat .env")).toBe(false);
    expect(read("true\n cat private/notes.md")).toBe(false);
    expect(read("echo hi\ncat src/app.ts")).toBe(true);
  });

  it("is not fooled by directory changes that do not last", () => {
    expect(read("(cd /tmp); cat .env")).toBe(false);
    expect(read("(cd /tmp) && cat .env")).toBe(false);
    expect(read("pushd /tmp; popd; cat .env")).toBe(false);
    expect(read('cd /tmp; cd "$OLDPWD"; cat .env')).toBe(false);
    expect(read("cd /tmp; cd ~-; cat .env")).toBe(false);
    expect(read("cd /tmp; cd -; cat .env")).toBe(false);
    expect(read("cd /tmp && cat .env")).toBe(true);
  });

  it("reads commands that follow shell keywords", () => {
    expect(read("if true; then cat .env; fi")).toBe(false);
    expect(read("if cat .env; then echo ok; fi")).toBe(false);
    expect(read("if true; then cd private; fi; cat notes.md")).toBe(false);
    expect(read("{ cat src/app.ts; }")).toBe(true);
  });

  it("ignores the body of a here-document", () => {
    expect(read("cat > notes.txt <<'EOF'\nsee private/notes.md\nEOF")).toBe(true);
  });
});

describe("WriteFence on multi-line and nested commands", () => {
  it("checks every line of a command", () => {
    expect(write("echo hi\nrm apps/api/a.ts")).toBe(false);
    expect(write("echo hi\nrm apps/web/a.ts")).toBe(true);
  });

  it("is not fooled by directory changes that do not last", () => {
    expect(write("(cd /tmp); rm apps/api/a.ts")).toBe(false);
    expect(write("pushd /tmp; popd; rm apps/api/a.ts")).toBe(false);
    expect(write('cd /tmp; cd "$OLDPWD"; touch apps/api/a.ts')).toBe(false);
    expect(write("cd /tmp && rm apps/api/a.ts")).toBe(true);
  });

  it("checks writes inside keyword blocks", () => {
    expect(write("if true; then rm apps/api/a.ts; fi")).toBe(false);
    expect(write("if true; then cd apps; fi; echo x > api/a.ts")).toBe(false);
  });
});

describe("Onyx's own files", () => {
  const shielded = new PathGuard(
    new ContextPolicy([...SECURITY_RULES]),
    ROOT,
    ["src/app.ts"],
    HOME,
    ["/var/lib/onyx/secret.key", "/var/lib/onyx/runtime", "/etc/onyx"],
  );
  const fenced = new WriteFence(ROOT, { name: "Frontend", globs: [] }, [], undefined, [
    "/var/lib/onyx/onyx.db",
  ]);

  it("keeps agents from reading them, wherever the command runs", () => {
    const denied = (command: string) => !shielded.evaluateCommand(command, ROOT).allowed;
    expect(denied("cat /var/lib/onyx/secret.key")).toBe(true);
    expect(denied("cd /var/lib/onyx && cat secret.key")).toBe(true);
    expect(denied("ls /var/lib/onyx/runtime/run-1")).toBe(true);
    expect(denied("cat /var/lib/onyx/*")).toBe(true);
    expect(denied("cat /etc/onyx/onyx.env")).toBe(true);
    expect(denied("cat /etc/hosts")).toBe(false);
    expect(
      shielded.evaluate({
        toolName: "Read",
        toolInput: { file_path: "/var/lib/onyx/secret.key" },
        cwd: ROOT,
      }).allowed,
    ).toBe(false);
  });

  it("keeps agents from changing them or the git metadata", () => {
    expect(fenced.evaluateCommand("cp x /var/lib/onyx/onyx.db", ROOT).allowed).toBe(false);
    expect(fenced.evaluateCommand("echo x >> .git/hooks/pre-commit", ROOT).allowed).toBe(false);
    expect(fenced.evaluateCommand("cd sub && touch ../.git/config", `${ROOT}`).allowed).toBe(false);
    expect(
      fenced.evaluate({
        toolName: "Write",
        toolInput: { file_path: `${ROOT}/.git/config`, content: "" },
        cwd: ROOT,
      }).allowed,
    ).toBe(false);
    expect(fenced.evaluateCommand("echo x > .gitignore", ROOT).allowed).toBe(true);
    expect(fenced.evaluateCommand("git commit -m x", ROOT).allowed).toBe(true);
  });
});
