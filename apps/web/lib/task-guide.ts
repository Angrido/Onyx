import type { QueueWaitReason, RunDto, RunStatus, TaskStatus, TddLoopDto } from "@onyx/contracts";
import { formatDuration, formatUsd } from "@/lib/format";
import { english, msg, type Params, type Translate } from "@/lib/i18n/core";
import { TDD_PHASE_LABELS } from "@/lib/tdd";

export type BannerTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface GuideText {
  key: string;
  params?: Params;
  translate?: readonly string[];
}

export type TaskAction =
  | "start"
  | "retry"
  | "relaunch"
  | "rerun"
  | "stop"
  | "allow"
  | "approvals"
  | "limits"
  | "publish"
  | "viewPullRequest"
  | "openPullRequest"
  | "followUp";

export type RunAction = "abort" | "allow" | "task";

export interface Banner<Action extends string> {
  tone: BannerTone;
  busy: boolean;
  title: GuideText;
  detail: GuideText | null;
  hint: GuideText | null;
  error: string | null;
  actions: Action[];
}

type RunFacts = Pick<RunDto, "status" | "errorMessage" | "changedFiles" | "costUsd" | "durationMs">;

export interface TaskBannerInput {
  status: TaskStatus;
  run: RunFacts | null;
  blockedCommands: number;
  waiting: QueueWaitReason | null;
  queuePosition: number | null;
  quotaHeld: boolean;
  resetLabel: string | null;
  activity: string | null;
  loop: Pick<TddLoopDto, "phase" | "iterationCount" | "maxIterations"> | null;
  hasPullRequest: boolean;
  branchName: string | null;
}

export interface RunBannerInput {
  status: RunStatus;
  run: RunFacts;
  blockedCommands: number;
  activity: string | null;
}

export function renderGuide(text: GuideText, t: Translate = english): string {
  if (!text.params) return t(text.key);
  const params = Object.fromEntries(
    Object.entries(text.params).map(([name, value]) => [
      name,
      text.translate?.includes(name) ? t(String(value)) : value,
    ]),
  );
  return t(text.key, params);
}

function text(key: string, params?: Params, translate?: readonly string[]): GuideText {
  return {
    key,
    ...(params ? { params } : {}),
    ...(translate ? { translate } : {}),
  };
}

function banner<Action extends string>(
  tone: BannerTone,
  title: GuideText,
  detail: GuideText | null,
  actions: Action[],
  extra: Partial<Pick<Banner<Action>, "busy" | "hint" | "error">> = {},
): Banner<Action> {
  return {
    tone,
    busy: extra.busy ?? false,
    title,
    detail,
    hint: extra.hint ?? null,
    error: extra.error ?? null,
    actions,
  };
}

const ACTIVITIES: ReadonlyArray<[RegExp, string]> = [
  [/^mcp__onyx__/, msg("Right now it is reading the project index.")],
  [/^(Read|NotebookRead)$/, msg("Right now it is reading files.")],
  [/^(Edit|MultiEdit|Write|NotebookEdit)$/, msg("Right now it is changing files.")],
  [/^Bash$/, msg("Right now it is running a command.")],
  [/^(Grep|Glob|LS)$/, msg("Right now it is searching the code.")],
  [/^(Task|Agent)$/, msg("Right now a helper agent is working on a part.")],
  [/^(WebFetch|WebSearch)$/, msg("Right now it is reading the web.")],
  [/^TodoWrite$/, msg("Right now it is updating its list of steps.")],
];

export function activityText(tool: string | null): GuideText {
  if (tool === null) return text(msg("Right now it is thinking or writing."));
  for (const [pattern, key] of ACTIVITIES) if (pattern.test(tool)) return text(key);
  return text(msg("Right now it is using {tool}."), { tool });
}

export function runSummary(run: RunFacts): GuideText {
  const count = run.changedFiles.length;
  const cost = formatUsd(run.costUsd);
  const duration = formatDuration(run.durationMs);
  if (count === 0) return text(msg("No file changed · {cost} · {duration}."), { cost, duration });
  if (count === 1) return text(msg("1 file changed · {cost} · {duration}."), { cost, duration });
  return text(msg("{count} files changed · {cost} · {duration}."), { count, cost, duration });
}

function blockedBanner<Action extends string>(actions: Action[]): Banner<Action> {
  return banner(
    "warning",
    text(msg("It stopped on commands it was not allowed to run")),
    text(msg("Choose the ones you trust and the agent picks up in the same session.")),
    actions,
  );
}

function queuedBanner(input: TaskBannerInput): Banner<TaskAction> {
  const position =
    input.queuePosition !== null && input.queuePosition > 0
      ? text(msg("Position {position} in the queue."), { position: input.queuePosition })
      : null;
  if (input.quotaHeld)
    return banner(
      "warning",
      text(msg("Waiting for the Claude window")),
      input.resetLabel
        ? text(
            msg(
              "Your Claude limits are almost used up: it starts by itself when they reset {time}.",
            ),
            { time: input.resetLabel },
          )
        : text(msg("Your Claude limits are almost used up: it starts by itself when they reset.")),
      ["limits", "stop"],
      { busy: true },
    );
  switch (input.waiting) {
    case "QUOTA":
      return banner(
        "warning",
        text(msg("Waiting for the limits or for your approval")),
        text(
          msg(
            "The Claude limits or a budget are holding it. If a budget passed its soft limit, approve it in Approvals.",
          ),
        ),
        ["approvals", "limits", "stop"],
        { busy: true },
      );
    case "SLOTS":
      return banner(
        "info",
        text(msg("In line: every agent slot is busy")),
        text(msg("It starts as soon as another run ends.")),
        ["stop"],
        { busy: true, hint: position },
      );
    case "PROJECT":
      return banner(
        "info",
        text(msg("In line: this project is at its run limit")),
        text(msg("It starts when another run of this project ends.")),
        ["stop"],
        { busy: true, hint: position },
      );
    case "WORKSPACE":
      return banner(
        "info",
        text(msg("In line: another agent is working in the same workspace")),
        text(msg("It starts when that run ends, so the two never change the same files.")),
        ["stop"],
        { busy: true, hint: position },
      );
    default:
      return banner(
        "info",
        text(msg("Starting soon")),
        text(msg("Onyx is about to start an agent.")),
        ["stop"],
        { busy: true, hint: position },
      );
  }
}

function completedBanner(input: TaskBannerInput): Banner<TaskAction> {
  const summary = input.run ? runSummary(input.run) : text(msg("The work is finished."));
  if (input.hasPullRequest)
    return banner("success", text(msg("Done")), summary, ["viewPullRequest", "followUp"], {
      hint: text(msg("The pull request is open: follow its checks on GitHub.")),
    });
  if (input.branchName)
    return banner("success", text(msg("Done")), summary, ["openPullRequest", "followUp"], {
      hint: text(msg("Published on {branch}: open a pull request when you are ready."), {
        branch: input.branchName,
      }),
    });
  if (input.run && input.run.changedFiles.length > 0)
    return banner("success", text(msg("Done")), summary, ["publish", "followUp"], {
      hint: text(
        msg("Check the changes in the steps below, then publish them from the project page."),
      ),
    });
  return banner("success", text(msg("Done")), summary, ["followUp"]);
}

export function taskBanner(input: TaskBannerInput): Banner<TaskAction> {
  const terminal =
    input.status === "COMPLETED" ||
    input.status === "FAILED" ||
    input.status === "CANCELLED" ||
    input.status === "INTERRUPTED";
  if (terminal && input.blockedCommands > 0) return blockedBanner<TaskAction>(["allow"]);
  switch (input.status) {
    case "DRAFT":
      return banner(
        "neutral",
        text(msg("Ready, not started yet")),
        text(
          msg(
            "Check the prompt, then start it: an agent works on it in its workspace and you follow every step here.",
          ),
        ),
        ["start"],
      );
    case "PLANNING":
      return banner(
        "info",
        text(msg("Claude is planning this work")),
        text(msg("When the plan is ready, Onyx asks you to approve it.")),
        [],
        { busy: true },
      );
    case "AWAITING_APPROVAL":
      return banner(
        "warning",
        text(msg("Waiting for your approval")),
        text(msg("Nothing starts until you decide in Approvals.")),
        ["approvals"],
      );
    case "QUEUED":
      return queuedBanner(input);
    case "RUNNING":
      return banner(
        "info",
        text(msg("The agent is working")),
        activityText(input.activity),
        ["stop"],
        {
          busy: true,
          hint: text(msg("Follow each step below. You can stop it at any time.")),
        },
      );
    case "TDD_LOOP":
      return banner(
        "info",
        text(msg("The TDD loop is running")),
        input.loop?.phase
          ? text(
              msg("{phase} · attempt {attempt} of {max}."),
              {
                phase: TDD_PHASE_LABELS[input.loop.phase],
                attempt: Math.max(1, input.loop.iterationCount),
                max: input.loop.maxIterations,
              },
              ["phase"],
            )
          : text(
              msg("Onyx runs the tests and has the agent fix what fails, until everything passes."),
            ),
        ["stop"],
        { busy: true },
      );
    case "COMPLETED":
      return completedBanner(input);
    case "FAILED":
      return banner(
        "danger",
        input.run?.status === "TIMEOUT"
          ? text(msg("It ran out of time"))
          : text(msg("It did not finish")),
        input.run?.errorMessage
          ? null
          : text(msg("Read the last steps below to see where it stopped, then try again.")),
        ["retry"],
        { error: input.run?.errorMessage ?? null },
      );
    case "INTERRUPTED":
      return banner(
        "warning",
        text(msg("Interrupted by an Onyx restart")),
        text(
          msg(
            "The work done so far is kept in the session: relaunch it to pick up where it stopped.",
          ),
        ),
        ["relaunch"],
      );
    case "CANCELLED":
      return banner(
        "neutral",
        text(msg("Cancelled")),
        text(msg("It was stopped before finishing. You can run it again whenever you want.")),
        ["rerun"],
      );
  }
}

export function runBanner(input: RunBannerInput): Banner<RunAction> {
  const { status, run } = input;
  const terminal = status !== "SPAWNING" && status !== "RUNNING";
  if (terminal && input.blockedCommands > 0) return blockedBanner<RunAction>(["allow", "task"]);
  switch (status) {
    case "SPAWNING":
      return banner(
        "info",
        text(msg("Starting the agent")),
        text(msg("Onyx is preparing the context and starting Claude Code.")),
        ["abort"],
        { busy: true },
      );
    case "RUNNING":
      return banner(
        "info",
        text(msg("The agent is working")),
        activityText(input.activity),
        ["abort"],
        {
          busy: true,
          hint: text(msg("Follow each step below. You can stop it at any time.")),
        },
      );
    case "COMPLETED":
      return banner("success", text(msg("Run finished")), runSummary(run), ["task"], {
        hint: text(
          msg("The next steps are on the task page: publish, open a pull request or ask for more."),
        ),
      });
    case "FAILED":
      return banner(
        "danger",
        text(msg("The run did not finish")),
        run.errorMessage ? null : text(msg("Read the last steps below to see where it stopped.")),
        ["task"],
        { error: run.errorMessage, hint: text(msg("You can try again from the task page.")) },
      );
    case "TIMEOUT":
      return banner(
        "danger",
        text(msg("The run ran out of time")),
        text(msg("Claude Code took longer than the time limit. Try again with a smaller request.")),
        ["task"],
      );
    case "ABORTED":
      return banner(
        "neutral",
        text(msg("Run stopped")),
        text(msg("It was stopped before finishing.")),
        ["task"],
      );
    case "INTERRUPTED":
      return banner(
        "warning",
        text(msg("Interrupted by an Onyx restart")),
        text(msg("Relaunch the task to continue from the same session.")),
        ["task"],
      );
  }
}

const TITLE_LIMIT = 80;

export function titleFromPrompt(prompt: string, limit = TITLE_LIMIT): string {
  const line =
    prompt
      .split("\n")
      .map((entry) =>
        entry
          .replace(/^\s*(?:#{1,6}|[-*+>]|\d+[.)])\s+/, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find((entry) => entry.length > 0) ?? "";
  if (line.length <= limit) return line;
  const cut = line.slice(0, limit - 1);
  const space = line[limit - 1] === " " ? cut.length : cut.lastIndexOf(" ");
  return `${(space > limit / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function taskTitle(title: string, prompt: string): string {
  return title.trim() || titleFromPrompt(prompt);
}
