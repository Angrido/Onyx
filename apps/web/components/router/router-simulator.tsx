"use client";

import {
  TaskKindSchema,
  type ProjectDetailDto,
  type ProjectDto,
  type RouterPreviewResponse,
  type RouterSettingsDto,
  type RoutingFeatures,
  type TaskKind,
} from "@onyx/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, FlaskConical, Loader2, Sparkles } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ScoreBar } from "@/components/router/score-bar";
import { ModelBadge, TierBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { DOMAIN_LABELS } from "@/lib/domains";
import { formatTokens } from "@/lib/format";
import { KIND_LABELS, WEIGHT_KEYS, WEIGHT_LABELS, splitList, weightSum } from "@/lib/router";
import { ROUTING_STRATEGY_LABELS } from "@/lib/sessions";
import { TIER_STYLES } from "@/lib/tiers";

function featureRows(features: RoutingFeatures): Array<[string, string]> {
  return [
    ["Kind", KIND_LABELS[features.kind]],
    [
      "Domains",
      features.domains.length > 0
        ? features.domains.map((domain) => DOMAIN_LABELS[domain]).join(", ")
        : "—",
    ],
    ["Cross-domain", features.crossDomain ? "yes" : "no"],
    ["Files touched", String(features.filesTouched)],
    ["Blast radius", String(features.blastRadius)],
    ["Context", formatTokens(features.contextTokens)],
    ["Arch keywords", features.archKeywords.length > 0 ? features.archKeywords.join(", ") : "—"],
    ["Style only", features.styleOnly ? "yes" : "no"],
    ["Prior failures", String(features.priorFailures)],
  ];
}

function PreviewResult({
  preview,
  settings,
}: {
  preview: RouterPreviewResponse;
  settings: RouterSettingsDto;
}) {
  const { decision } = preview;
  const style = TIER_STYLES[decision.tier];
  const max = weightSum(settings.weights);
  return (
    <motion.div
      key={`${decision.tier}-${decision.modelId}-${decision.score ?? "rule"}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
      data-testid="router-preview"
    >
      <div className={`rounded-xl border p-4 ${style.border} ${style.bg} ${style.glow}`}>
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={decision.tier} />
          <ModelBadge modelId={decision.modelId} />
          <Badge>
            {ROUTING_STRATEGY_LABELS[decision.strategy]}
            {decision.ruleName ? ` · ${decision.ruleName}` : ""}
          </Badge>
          {preview.classifierUsed ? (
            <Badge tone="primary">
              <Bot className="size-3" />
              classifier
            </Badge>
          ) : null}
        </div>
        <p className="mt-2 text-sm leading-relaxed">{decision.rationale}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Workspace{" "}
          <span className="font-medium text-foreground">{preview.workspaceName ?? "none"}</span>
          {preview.workspaceInferred ? " · inferred from the target paths" : ""}
        </p>
      </div>
      {decision.components ? (
        <div className="space-y-3">
          <ScoreBar
            score={decision.score}
            max={max}
            thresholds={settings.thresholds}
            tier={decision.tier}
          />
          <div className="space-y-1.5">
            {WEIGHT_KEYS.map((key) => {
              const value = decision.components?.[key] ?? 0;
              const weight = settings.weights[key];
              return (
                <div
                  key={key}
                  className="grid grid-cols-[9rem_1fr_3rem] items-center gap-2 text-xs"
                >
                  <span className="text-muted-foreground">{WEIGHT_LABELS[key].label}</span>
                  <div className="h-1.5 rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${weight > 0 ? (value / weight) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="tabular text-right">{value.toFixed(2)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {decision.features ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-lg border border-border bg-surface-0/60 p-3 text-xs sm:grid-cols-3">
          {featureRows(decision.features).map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {label}
              </dt>
              <dd className="truncate font-medium" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </motion.div>
  );
}

export function RouterSimulator({
  projects,
  settings,
}: {
  projects: ProjectDto[];
  settings: RouterSettingsDto;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [workspaceId, setWorkspaceId] = useState("");
  const [kind, setKind] = useState<TaskKind>("FEATURE");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [targets, setTargets] = useState("");

  const project = useQuery({
    queryKey: queryKeys.project(projectId),
    queryFn: () => api.get<ProjectDetailDto>(`/api/projects/${projectId}`),
    enabled: projectId.length > 0,
  });

  const preview = useMutation({
    mutationFn: () =>
      api.post<RouterPreviewResponse>("/api/router/preview", {
        projectId,
        workspaceId: workspaceId || null,
        title,
        prompt,
        kind,
        targetPaths: splitList(targets),
      }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    preview.mutate();
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" />
          Simulator
        </CardTitle>
        <CardDescription>
          Dry-run a task through the rules, the heuristic and the classifier. Nothing is recorded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">Register a project to simulate routing.</p>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Project" htmlFor="sim-project">
                <Select
                  id="sim-project"
                  value={projectId}
                  onChange={(event) => {
                    setProjectId(event.target.value);
                    setWorkspaceId("");
                  }}
                >
                  {projects.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Workspace" htmlFor="sim-workspace">
                <Select
                  id="sim-workspace"
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                >
                  <option value="">Auto</option>
                  {(project.data?.workspaces ?? []).map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Kind" htmlFor="sim-kind">
                <Select
                  id="sim-kind"
                  value={kind}
                  onChange={(event) => setKind(TaskKindSchema.parse(event.target.value))}
                >
                  {TaskKindSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {KIND_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Title" htmlFor="sim-title">
              <Input
                id="sim-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
            <Field label="Prompt" htmlFor="sim-prompt">
              <Textarea
                id="sim-prompt"
                className="min-h-24 font-mono text-xs"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Redesign the session schema and migrate the existing rows"
                required
              />
            </Field>
            <Field
              label="Target paths"
              htmlFor="sim-targets"
              hint="Comma or newline separated; they drive blast radius and workspace inference."
            >
              <Input
                id="sim-targets"
                className="font-mono text-xs"
                value={targets}
                onChange={(event) => setTargets(event.target.value)}
                placeholder="apps/web/src/button.tsx"
              />
            </Field>
            <Button type="submit" disabled={preview.isPending || prompt.trim().length === 0}>
              {preview.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Simulate
            </Button>
          </form>
        )}
        <AnimatePresence mode="wait">
          {preview.data ? <PreviewResult preview={preview.data} settings={settings} /> : null}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}
