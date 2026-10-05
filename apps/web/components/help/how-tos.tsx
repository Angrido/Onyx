import {
  ArrowUpRight,
  CircleAlert,
  ListChecks,
  PiggyBank,
  Play,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { GlossaryChips } from "@/components/help/glossary-chips";
import type { GlossaryId } from "@/lib/glossary";
import { msg, type Translate } from "@/lib/i18n/core";

interface HowTo {
  id: string;
  title: string;
  icon: LucideIcon;
  steps: readonly string[];
  links: readonly { href: string; label: string }[];
  terms: readonly GlossaryId[];
}

const HOW_TOS: readonly HowTo[] = [
  {
    id: "start-a-task",
    title: msg("Start a task"),
    icon: Play,
    steps: [
      msg("Open the project from Projects."),
      msg("Press New task, write what you want and choose the workspace, or leave it to Onyx."),
      msg("Start it: the run page shows what the agent does, live."),
      msg("When it ends, read the changes and merge them, or reply to the agent."),
    ],
    links: [{ href: "/projects", label: msg("Projects") }],
    terms: ["workspace", "session"],
  },
  {
    id: "plan-a-feature",
    title: msg("Plan a bigger feature"),
    icon: ListChecks,
    steps: [
      msg("In the project, press Plan a feature and describe the goal."),
      msg("Claude splits it into small tasks with their order. Read the plan and approve it."),
      msg("Agents work on the tasks in parallel, each on its own copy of the project."),
      msg(
        "Onyx merges them on one branch; with QA review on, a read-only agent checks each task first.",
      ),
    ],
    links: [{ href: "/approvals", label: msg("Approvals") }],
    terms: ["plan", "worktree", "qa"],
  },
  {
    id: "run-failed",
    title: msg("When a run fails or a command is refused"),
    icon: CircleAlert,
    steps: [
      msg("Open the run: the last lines of its output say why it stopped."),
      msg(
        "If a command was refused, press Allow and continue: you choose whether it applies to this task or to the agent, and for how long.",
      ),
      msg("If the run ran out of turns, Onyx can queue it again on a stronger model by itself."),
      msg("Otherwise reply to the agent with what to change and run it again."),
    ],
    links: [],
    terms: ["commands", "guard", "fence", "router"],
  },
  {
    id: "read-savings",
    title: msg("Read Savings"),
    icon: PiggyBank,
    steps: [
      msg("Measured means Onyx compared the token counts Claude reported on real runs."),
      msg(
        "Estimated means Onyx calculated what it avoided sending, such as files Claude did not have to read.",
      ),
      msg("The two are not added up, because they are counted in different ways."),
      msg("To turn an estimate into a measurement, run the experiment on the Savings page."),
    ],
    links: [{ href: "/savings", label: msg("Savings") }],
    terms: ["token", "cache", "context"],
  },
  {
    id: "logs-and-diagnostics",
    title: msg("Find logs and diagnostics"),
    icon: ScrollText,
    steps: [
      msg("Each run keeps its own output on its page."),
      msg("Logs shows the last lines written by Onyx, with secrets masked."),
      msg(
        "In Settings, Diagnostics prepares one file with versions, health and recent errors, to send when you ask for help.",
      ),
    ],
    links: [
      { href: "/logs", label: msg("Logs") },
      { href: "/settings#diagnostics", label: msg("Diagnostics") },
    ],
    terms: [],
  },
];

export function HowTos({ t }: { t: Translate }) {
  return (
    <section id="how-to" aria-labelledby="how-to-title" className="scroll-mt-20 space-y-4">
      <div className="space-y-1">
        <h2 id="how-to-title" className="text-lg font-semibold tracking-tight">
          {t("How to")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("The things you do most often.")}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {HOW_TOS.map((howTo) => (
          <Card
            key={howTo.id}
            id={howTo.id}
            className="flex scroll-mt-20 flex-col gap-3 p-4 md:scroll-mt-8"
          >
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <howTo.icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
              {t(howTo.title)}
            </h3>
            <ol className="flex-1 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground marker:text-muted-foreground">
              {howTo.steps.map((step) => (
                <li key={step}>{t(step)}</li>
              ))}
            </ol>
            {howTo.links.length > 0 || howTo.terms.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {howTo.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex min-h-7 items-center gap-1 text-xs font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {t(link.label)}
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                ))}
                <GlossaryChips terms={howTo.terms} t={t} />
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </section>
  );
}
