import { describe, expect, it } from "vitest";
import { errorText, explainError } from "@/lib/errors";
import { translator } from "@/lib/i18n/core";

const it_ = translator("it");

describe("readable errors", () => {
  it("explains known API errors with a fix, in both languages", () => {
    expect(
      explainError("An agent is working on this project: wait until it finishes", 409),
    ).toEqual({
      message: "An agent is working on this project.",
      fix: "Wait until it finishes, or stop it from its task.",
    });
    expect(
      explainError("An agent is working on this project: wait until it finishes", 409, it_),
    ).toEqual({
      message: "Un agente sta lavorando su questo progetto.",
      fix: "Aspetta che finisca, oppure fermalo dal suo task.",
    });
  });

  it("keeps the values named in the message", () => {
    expect(explainError("Choose a branch other than main", 400, it_).message).toBe(
      "Non puoi pubblicare su main.",
    );
    expect(
      explainError("A project named shop already exists: choose another name", 409).message,
    ).toBe("A project named shop already exists.");
    expect(explainError("Model claude-x is not enabled", 400).message).toBe(
      "The model claude-x is not enabled.",
    );
  });

  it("covers the network, the session, the rate limit and server errors", () => {
    expect(explainError("Failed to fetch", null).message).toBe("Onyx does not answer.");
    expect(explainError("Unauthorized", 401).fix).toBe("Sign in again.");
    expect(explainError("Slow down", 429).message).toBe("Too many requests.");
    expect(explainError("Database locked", 500)).toMatchObject({ message: "Database locked" });
    expect(explainError("Database locked", 500).fix).toContain("onyx-status");
  });

  it("explains a branch that does not exist on GitHub", () => {
    const refused = explainError(
      "The branch onyx/automated does not exist on Angrido/Onyx: leave the field empty to clone main, or pick one of main, dev",
      400,
      translator("it"),
    );
    expect(refused).toEqual({
      message: "Il branch onyx/automated non esiste su Angrido/Onyx.",
      fix: "Lascia il branch predefinito (main) o scegline uno dall'elenco.",
    });
    const cloned = explainError(
      "Cloning into '/root/Onyx/.onyx-data/projects/Onyx'...\nfatal: Remote branch onyx/automated not found in upstream origin",
      null,
    );
    expect(cloned.message).toBe("The branch onyx/automated does not exist on GitHub.");
    expect(cloned.fix).toBe("Keep the default branch or pick one from the list.");
  });

  it("passes unknown messages through", () => {
    expect(explainError("Something specific", 400)).toEqual({
      message: "Something specific",
      fix: null,
    });
    expect(explainError("  ", 400)).toEqual({ message: "Unexpected error", fix: null });
    expect(errorText({ message: "A.", fix: "B." })).toBe("A. B.");
    expect(errorText({ message: "A.", fix: null })).toBe("A.");
  });
});
