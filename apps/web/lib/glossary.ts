import { msg } from "@/lib/i18n/core";

export type GlossaryId =
  | "workspace"
  | "session"
  | "handoff"
  | "context"
  | "map"
  | "tier"
  | "router"
  | "token"
  | "cache"
  | "tdd"
  | "plan"
  | "worktree"
  | "approval"
  | "surgeon"
  | "mcp"
  | "commands"
  | "canWait"
  | "budget"
  | "memory"
  | "index"
  | "graph"
  | "insights"
  | "ideation"
  | "qa"
  | "fence"
  | "guard"
  | "limits";

export interface GlossaryEntry {
  id: GlossaryId;
  term: string;
  definition: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    id: "workspace",
    term: msg("Workspace"),
    definition: msg(
      "An area of the project, such as frontend or backend, defined by folders. Each workspace keeps its own Claude conversations, so an agent only works on the files of its area.",
    ),
  },
  {
    id: "session",
    term: msg("Session"),
    definition: msg(
      "A Claude conversation that runs continue. Resuming it reuses what Claude already read, which costs fewer tokens than starting over.",
    ),
  },
  {
    id: "handoff",
    term: msg("Handoff"),
    definition: msg(
      "When a task moves to another area or the conversation gets too long, Onyx starts a new session and passes a short summary of the previous one instead of the whole history.",
    ),
  },
  {
    id: "context",
    term: msg("Onyx context"),
    definition: msg(
      "What Onyx sends to Claude before it starts: the files of the task, the parts of the related files it needs and a map of the project. It avoids Claude reading whole folders.",
    ),
  },
  {
    id: "map",
    term: msg("Project map"),
    definition: msg(
      "A compact list of the project's files and their main functions, built from the code index and sent at the start of a session.",
    ),
  },
  {
    id: "tier",
    term: msg("Model level"),
    definition: msg(
      "Onyx groups the Claude models in three levels: Architect (the strongest, for plans), Builder (for normal changes) and Scout (the cheapest, for small or read-only work).",
    ),
  },
  {
    id: "router",
    term: msg("Router"),
    definition: msg(
      "The part of Onyx that picks the model for each run: the cheapest level that should finish the task, and a stronger one if the run fails for lack of turns.",
    ),
  },
  {
    id: "token",
    term: msg("Token"),
    definition: msg(
      "The unit Claude counts text in, roughly three quarters of a word. Your subscription limits and costs are measured in tokens.",
    ),
  },
  {
    id: "cache",
    term: msg("Cache"),
    definition: msg(
      "Text Claude has just read and can read again at a tenth of the price. It lasts a few minutes, so runs that resume quickly cost less.",
    ),
  },
  {
    id: "tdd",
    term: msg("TDD loop"),
    definition: msg(
      "Onyx runs the tests, gives the agent a short summary of what fails and repeats until everything passes or the attempts run out. The tests themselves cannot be changed by the agent.",
    ),
  },
  {
    id: "plan",
    term: msg("Plan"),
    definition: msg(
      "A larger feature split by Claude into small tasks with their order. You approve the plan, then agents work on the tasks in parallel and Onyx merges them on one branch.",
    ),
  },
  {
    id: "worktree",
    term: msg("Worktree"),
    definition: msg(
      "A separate copy of the project folder on its own branch, so that agents working in parallel do not change each other's files.",
    ),
  },
  {
    id: "approval",
    term: msg("Approval"),
    definition: msg(
      "A decision Onyx leaves to you before anything irreversible: starting a plan, merging a task, resolving a conflict or spending beyond a budget.",
    ),
  },
  {
    id: "surgeon",
    term: msg("Context Surgeon"),
    definition: msg(
      "The page where you choose which files Claude may never read, such as secrets, build output or large data, for the whole project or one workspace.",
    ),
  },
  {
    id: "mcp",
    term: msg("onyx tools"),
    definition: msg(
      "Tools Onyx gives Claude during a run to read only a function, the outline of a file or who uses what, instead of whole files.",
    ),
  },
  {
    id: "commands",
    term: msg("Allowed commands"),
    definition: msg(
      "Commands agents may run without asking, such as tests and lint. Anything else is refused during a run, and the run page lets you allow it and continue.",
    ),
  },
  {
    id: "canWait",
    term: msg("Can wait"),
    definition: msg(
      "A task marked like this waits when your Claude subscription is near its limit and starts by itself when the window resets.",
    ),
  },
  {
    id: "budget",
    term: msg("Budget"),
    definition: msg(
      "A spending limit. Above the soft limit new runs wait for your approval; at the hard limit Onyx stops them.",
    ),
  },
  {
    id: "memory",
    term: msg("Project memory"),
    definition: msg(
      "Short facts Onyx learns from the runs, such as the test command or files that matter, given to new sessions so Claude explores less.",
    ),
  },
  {
    id: "index",
    term: msg("Code index"),
    definition: msg(
      "What Onyx knows about the project's code: files, functions and who imports what. It is updated after every run and costs no tokens.",
    ),
  },
  {
    id: "graph",
    term: msg("Graph"),
    definition: msg(
      "A drawing of which files import which, to see the central files and the circular dependencies.",
    ),
  },
  {
    id: "insights",
    term: msg("Insights"),
    definition: msg(
      "Questions about the code. Many are answered from the index for free; the others go to the cheapest model.",
    ),
  },
  {
    id: "ideation",
    term: msg("Ideation"),
    definition: msg(
      "A free check of the code for security and performance problems. Claude looks only at the suspicious lines, and only if you ask.",
    ),
  },
  {
    id: "qa",
    term: msg("QA review"),
    definition: msg(
      "An extra read-only agent that checks each task of a plan against its acceptance criteria before the merge.",
    ),
  },
  {
    id: "fence",
    term: msg("Fence"),
    definition: msg(
      "The folders an agent may write to. Hard fences block writes outside them; handoff fences let the agent leave the area with a new session.",
    ),
  },
  {
    id: "guard",
    term: msg("Guard"),
    definition: msg(
      "A check Onyx runs before each command and file read of an agent, to block secrets and dangerous commands.",
    ),
  },
  {
    id: "limits",
    term: msg("Claude limits"),
    definition: msg(
      "Claude Max lets you use a certain amount in each 5-hour window and each week. Onyx shows how much is used and can hold tasks that can wait.",
    ),
  },
];

export function glossaryEntry(id: GlossaryId): GlossaryEntry {
  const entry = GLOSSARY.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Unknown glossary term ${id}`);
  return entry;
}
