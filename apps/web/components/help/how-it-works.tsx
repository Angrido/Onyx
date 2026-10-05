import {
  FolderGit2,
  GitMerge,
  Layers,
  PencilLine,
  PiggyBank,
  Play,
  type LucideIcon,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { GlossaryChips } from "@/components/help/glossary-chips";
import type { GlossaryId } from "@/lib/glossary";
import { msg, type Translate } from "@/lib/i18n/core";

interface Step {
  title: string;
  text: string;
  icon: LucideIcon;
  terms: readonly GlossaryId[];
}

const STEPS: readonly Step[] = [
  {
    title: msg("Add a project"),
    text: msg(
      "Point Onyx at a folder or import a repository from GitHub. Onyx reads the code and builds its index without spending tokens.",
    ),
    icon: FolderGit2,
    terms: ["index"],
  },
  {
    title: msg("Split it into workspaces"),
    text: msg(
      "A workspace is an area of the project, such as frontend or backend. Onyx proposes them from the folders, and each one keeps its own Claude conversations.",
    ),
    icon: Layers,
    terms: ["workspace", "session"],
  },
  {
    title: msg("Write a task"),
    text: msg(
      "Describe what you want in a few lines, as you would to a colleague. If it is not urgent, mark it as one that can wait.",
    ),
    icon: PencilLine,
    terms: ["canWait"],
  },
  {
    title: msg("Run it"),
    text: msg(
      "An agent works on the task in its workspace. Onyx picks the model, sends only the files that matter and runs the tests until they pass.",
    ),
    icon: Play,
    terms: ["router", "context", "tdd"],
  },
  {
    title: msg("Review and merge"),
    text: msg(
      "Read the changes and the summary, then merge them, or reply to the agent and run it again. Anything irreversible waits for you in Approvals.",
    ),
    icon: GitMerge,
    terms: ["approval", "worktree"],
  },
  {
    title: msg("Check the savings"),
    text: msg(
      "Savings shows how many tokens Onyx saved and how it knows: measured on real runs or estimated.",
    ),
    icon: PiggyBank,
    terms: ["token", "cache"],
  },
];

export function HowItWorks({ t }: { t: Translate }) {
  return (
    <section
      id="how-it-works"
      aria-labelledby="how-it-works-title"
      className="scroll-mt-20 space-y-4"
    >
      <div className="space-y-1">
        <h2 id="how-it-works-title" className="text-lg font-semibold tracking-tight">
          {t("How Onyx works")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("From a folder to merged code, in six steps.")}
        </p>
      </div>
      <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title}>
            <Card className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-primary/40 bg-primary/12 text-sm font-semibold text-primary">
                  {index + 1}
                </span>
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight">
                  <step.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  {t(step.title)}
                </h3>
              </div>
              <p className="flex-1 text-sm leading-relaxed text-muted-foreground">{t(step.text)}</p>
              <GlossaryChips terms={step.terms} t={t} />
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}
