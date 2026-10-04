import { describe, expect, it } from "vitest";
import { destructiveReason } from "../src";

describe("destructive commands refused whatever the allow rules", () => {
  it.each([
    "rm -rf build",
    "rm -fr build",
    "rm -r -f build",
    "rm --recursive --force build",
    "rm -Rf ~",
    "timeout 5 rm -rf ~",
    "nice -n 5 rm -rf /",
    "cd x && rm -rf .",
    "(cd x; rm -rf .)",
    "sudo ls",
    "env doas id",
    "git push origin main",
    "git -C . push",
    "git -c x=y push --force",
    'bash -c "rm -rf dist"',
    "eval rm -fr dist",
  ])("%s", (command) => {
    expect(destructiveReason(command)).not.toBeNull();
  });

  it.each([
    "rm -r build",
    "rm -f a.txt",
    "git status",
    "git log --oneline",
    "echo sudo",
    "pnpm test",
  ])("lets %s through", (command) => {
    expect(destructiveReason(command)).toBeNull();
  });
});
