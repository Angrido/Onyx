import { describe, expect, it } from "vitest";
import { projectNameFor, remoteKey } from "../../src/application/github-service";
import {
  basicAuthHeader,
  credentialEnv,
  parseGitProgress,
  redact,
} from "../../src/infrastructure/git-clone";

describe("git clone helpers", () => {
  it("parses progress lines from git and the remote", () => {
    expect(parseGitProgress("Receiving objects:  45% (450/1000), 1.2 MiB | 2 MiB/s")).toEqual({
      phase: "Receiving objects",
      percent: 45,
    });
    expect(parseGitProgress("remote: Compressing objects: 100% (12/12), done.")).toEqual({
      phase: "Compressing objects",
      percent: 100,
    });
    expect(parseGitProgress("Cloning into 'shop'...")).toBeNull();
  });

  it("passes the token through git config environment, never arguments", () => {
    const env = credentialEnv("ghp_secret", "https://github.com");
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: "3",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_KEY_2: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_2: basicAuthHeader("ghp_secret"),
    });
    expect(credentialEnv(null, null)).toEqual({
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "credential.helper",
      GIT_CONFIG_VALUE_0: "",
      GIT_CONFIG_KEY_1: "core.askPass",
      GIT_CONFIG_VALUE_1: "",
    });
  });

  it("redacts secrets from messages", () => {
    expect(redact("fatal: ghp_secret rejected ghp_secret", ["ghp_secret", ""])).toBe(
      "fatal: *** rejected ***",
    );
  });
});

describe("github import helpers", () => {
  it("normalises remotes so imported repositories are recognised", () => {
    expect(remoteKey("https://github.com/Octo/Shop.git")).toBe("github.com/octo/shop");
    expect(remoteKey("git@github.com:octo/shop.git")).toBe("github.com/octo/shop");
    expect(remoteKey("https://user@github.com/octo/shop/")).toBe("github.com/octo/shop");
  });

  it("derives a safe project name from the repository", () => {
    expect(projectNameFor("my app!")).toBe("my-app-");
    expect(projectNameFor(".dotfiles")).toBe("dotfiles");
    expect(projectNameFor("___")).toBe("project");
  });
});
