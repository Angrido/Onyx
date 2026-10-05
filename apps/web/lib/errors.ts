import { english, msg, type Translate } from "@/lib/i18n/core";

export interface ExplainedError {
  message: string;
  fix: string | null;
}

interface ErrorRule {
  pattern: RegExp;
  message: string;
  fix: string | null;
  names?: readonly string[];
}

const RULES: readonly ErrorRule[] = [
  {
    pattern: /^An agent is working on this project/,
    message: msg("An agent is working on this project."),
    fix: msg("Wait until it finishes, or stop it from its task."),
  },
  {
    pattern: /^Every agent slot is busy/,
    message: msg("Every agent slot is busy."),
    fix: msg("Wait for a run to end, or raise MAX_CONCURRENT_AGENTS on the server."),
  },
  {
    pattern: /^Onyx is shutting down/,
    message: msg("Onyx is restarting."),
    fix: msg("Try again in a minute."),
  },
  {
    pattern: /GitHub rejected the token/,
    message: msg("GitHub rejected the token."),
    fix: msg("Connect a new token in Settings, GitHub card."),
  },
  {
    pattern: /GitHub rate limit reached/,
    message: msg("GitHub's hourly limit is reached."),
    fix: msg("Wait for the reset, or connect a token to raise the limit."),
  },
  {
    pattern: /^Not found on GitHub/,
    message: msg("GitHub does not show this repository or item."),
    fix: msg("Check the name, and that the token can see the repository."),
  },
  {
    pattern: /token cannot do this|Pull requests read and write/,
    message: msg("The GitHub token is missing a permission."),
    fix: msg("Create a token with Pull requests read and write and connect it in Settings."),
  },
  {
    pattern: /GitHub is unreachable/,
    message: msg("GitHub cannot be reached from the Onyx server."),
    fix: msg("Check the network of the server."),
  },
  {
    pattern: /has no GitHub remote|has no origin remote/,
    message: msg("The project has no GitHub remote."),
    fix: msg("Point origin to the GitHub repository in the project folder."),
  },
  {
    pattern: /^Nothing to publish/,
    message: msg("There is nothing to publish."),
    fix: msg("Run a task that changes files first."),
  },
  {
    pattern: /^Choose a branch other than (.+)$/,
    message: msg("You cannot publish on {branch}."),
    fix: msg("Choose another branch name."),
    names: ["branch"],
  },
  {
    pattern: /^Publish or discard the current changes/,
    message: msg("There are changes not yet published."),
    fix: msg("Publish or discard them, then switch branch."),
  },
  {
    pattern: /not indexed yet|has not been indexed|^Index the project first/,
    message: msg("The project is not indexed yet."),
    fix: msg("Wait for the index on the project page, then try again."),
  },
  {
    pattern: /is not a git repository|must be a git repository/,
    message: msg("The project folder is not a git repository."),
    fix: msg("Run git init in the folder, or import the project from GitHub."),
  },
  {
    pattern: /^Model (.+) is not enabled/,
    message: msg("The model {model} is not enabled."),
    fix: msg("Enable it in Router, or choose another model."),
    names: ["model"],
  },
  {
    pattern: /^No enabled model/,
    message: msg("No model is enabled."),
    fix: msg("Enable at least one model in Router."),
  },
  {
    pattern: /^Task is already queued or running/,
    message: msg("The task is already queued or running."),
    fix: msg("Wait for it to finish, or stop it."),
  },
  {
    pattern: /^This (plan|request|suggestion) (is not waiting|was already|was decided)/,
    message: msg("Someone already decided this."),
    fix: msg("Reload the page to see the current state."),
  },
  {
    pattern: /^A project named (.+) already exists/,
    message: msg("A project named {name} already exists."),
    fix: msg("Choose another name."),
    names: ["name"],
  },
  {
    pattern: /^Path .+ (does not exist|is not a directory)|^Path must be inside one of/,
    message: msg("This folder cannot be used."),
    fix: msg("Choose an existing folder inside the allowed roots (ONYX_ALLOWED_PROJECT_ROOTS)."),
  },
  {
    pattern: /^Claude (could not|did not)|^Claude Code stopped|^The review (stopped|failed)/,
    message: msg("Claude did not finish."),
    fix: msg("Check the Claude account in Settings, then try again."),
  },
  {
    pattern: /^Spent .+ New runs in this scope wait/,
    message: msg("A budget is reached."),
    fix: msg("Approve the waiting runs in Approvals, or raise the budget in Settings."),
  },
];

const NETWORK = /Failed to fetch|NetworkError|Load failed|fetch failed/i;

export function explainError(
  raw: string,
  status: number | null,
  t: Translate = english,
): ExplainedError {
  const text = raw.trim();
  for (const rule of RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const params = Object.fromEntries(
      (rule.names ?? []).map((name, index) => [name, match[index + 1] ?? ""]),
    );
    return { message: t(rule.message, params), fix: rule.fix ? t(rule.fix) : null };
  }
  if (NETWORK.test(text))
    return {
      message: t("Onyx does not answer."),
      fix: t("Check that the service is running (onyx-status on the server) and the network."),
    };
  if (status === 401) return { message: t("Your session has expired."), fix: t("Sign in again.") };
  if (status === 429)
    return { message: t("Too many requests."), fix: t("Wait a moment and try again.") };
  if (status !== null && status >= 500)
    return {
      message: text.length > 0 ? text : t("Onyx hit an unexpected error."),
      fix: t("Try again; if it happens again, run onyx-status on the server and read the log."),
    };
  return { message: text.length > 0 ? text : t("Unexpected error"), fix: null };
}

export function errorText(explained: ExplainedError): string {
  return explained.fix ? `${explained.message} ${explained.fix}` : explained.message;
}
