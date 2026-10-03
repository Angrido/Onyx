"use client";

import {
  DomainSchema,
  ModelTierSchema,
  TaskKindSchema,
  type CatalogResponse,
  type CreateRoutingRuleRequest,
  type Domain,
  type ModelTier,
  type ProjectDto,
  type RoutingRuleDto,
  type RoutingRuleListResponse,
  type RuleMatcher,
  type TaskKind,
} from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ModelSelect } from "@/components/tasks/model-select";
import { ModelBadge, TierBadge } from "@/components/tasks/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, Input, Label, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { DOMAIN_LABELS } from "@/lib/domains";
import { KIND_LABELS, describeMatcher, splitList } from "@/lib/router";
import { TIER_STYLES } from "@/lib/tiers";
import { cn } from "@/lib/utils";

interface RuleDraft {
  name: string;
  priority: string;
  projectId: string;
  targetTier: ModelTier;
  modelId: string;
  enabled: boolean;
  taskKinds: TaskKind[];
  domains: Domain[];
  pathGlobs: string;
  keywords: string;
  maxFilesTouched: string;
  maxBlastRadius: string;
  styleOnly: boolean;
}

function draftOf(rule: RoutingRuleDto | null): RuleDraft {
  return {
    name: rule?.name ?? "",
    priority: String(rule?.priority ?? 50),
    projectId: rule?.projectId ?? "",
    targetTier: rule?.targetTier ?? "BUILDER",
    modelId: rule?.modelId ?? "",
    enabled: rule?.enabled ?? true,
    taskKinds: rule?.matcher.taskKinds ?? [],
    domains: rule?.matcher.workspaceDomains ?? [],
    pathGlobs: (rule?.matcher.pathGlobs ?? []).join("\n"),
    keywords: (rule?.matcher.keywordsAny ?? []).join(", "),
    maxFilesTouched:
      rule?.matcher.maxFilesTouched === undefined ? "" : String(rule.matcher.maxFilesTouched),
    maxBlastRadius:
      rule?.matcher.maxBlastRadius === undefined ? "" : String(rule.matcher.maxBlastRadius),
    styleOnly: rule?.matcher.styleOnly ?? false,
  };
}

function optionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function matcherOf(draft: RuleDraft): RuleMatcher {
  const pathGlobs = splitList(draft.pathGlobs);
  const keywordsAny = splitList(draft.keywords);
  const maxFilesTouched = optionalInt(draft.maxFilesTouched);
  const maxBlastRadius = optionalInt(draft.maxBlastRadius);
  return {
    ...(draft.taskKinds.length > 0 ? { taskKinds: draft.taskKinds } : {}),
    ...(draft.domains.length > 0 ? { workspaceDomains: draft.domains } : {}),
    ...(pathGlobs.length > 0 ? { pathGlobs } : {}),
    ...(keywordsAny.length > 0 ? { keywordsAny } : {}),
    ...(maxFilesTouched === undefined ? {} : { maxFilesTouched }),
    ...(maxBlastRadius === undefined ? {} : { maxBlastRadius }),
    ...(draft.styleOnly ? { styleOnly: true } : {}),
  };
}

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border bg-surface-1 text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function RuleDialog({
  rule,
  open,
  onOpenChange,
  projects,
  catalog,
}: {
  rule: RoutingRuleDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectDto[];
  catalog: CatalogResponse;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RuleDraft>(() => draftOf(rule));
  const update = (patch: Partial<RuleDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const save = useMutation({
    mutationFn: async () => {
      const fields = {
        name: draft.name.trim(),
        priority: optionalInt(draft.priority) ?? 50,
        matcher: matcherOf(draft),
        targetTier: draft.targetTier,
        modelId: draft.modelId || null,
        enabled: draft.enabled,
      };
      if (rule) return api.patch<RoutingRuleDto>(`/api/routing-rules/${rule.id}`, fields);
      const body: CreateRoutingRuleRequest = { ...fields, projectId: draft.projectId || null };
      return api.post<RoutingRuleDto>("/api/routing-rules", body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.routingRules });
      toast.success(rule ? "Rule updated" : "Rule created");
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  const preview = describeMatcher(matcherOf(draft));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,42rem)]">
        <DialogHeader>
          <DialogTitle>{rule ? `Edit ${rule.name}` : "New routing rule"}</DialogTitle>
          <DialogDescription>
            Every condition you set must hold. Rules run by ascending priority; on a tie, project
            rules win over global ones.
          </DialogDescription>
        </DialogHeader>
        <form
          className="scrollbar-thin max-h-[70vh] space-y-4 overflow-y-auto pr-1"
          onSubmit={submit}
        >
          <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
            <Field label="Name" htmlFor="rule-name">
              <Input
                id="rule-name"
                value={draft.name}
                onChange={(event) => update({ name: event.target.value })}
                required
              />
            </Field>
            <Field label="Priority" htmlFor="rule-priority">
              <Input
                id="rule-priority"
                type="number"
                min={0}
                max={10_000}
                value={draft.priority}
                onChange={(event) => update({ priority: event.target.value })}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Scope" htmlFor="rule-scope">
              <Select
                id="rule-scope"
                value={draft.projectId}
                disabled={rule !== null}
                onChange={(event) => update({ projectId: event.target.value })}
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tier" htmlFor="rule-tier">
              <Select
                id="rule-tier"
                value={draft.targetTier}
                onChange={(event) =>
                  update({ targetTier: ModelTierSchema.parse(event.target.value) })
                }
              >
                {ModelTierSchema.options.map((tier) => (
                  <option key={tier} value={tier}>
                    {TIER_STYLES[tier].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Model" htmlFor="rule-model">
              <ModelSelect
                id="rule-model"
                models={catalog.models}
                value={draft.modelId}
                onChange={(modelId) => update({ modelId })}
                defaultLabel="Tier default"
              />
            </Field>
          </div>
          <div className="space-y-2">
            <Label>Task kinds</Label>
            <div className="flex flex-wrap gap-1.5">
              {TaskKindSchema.options.map((kind) => (
                <Chip
                  key={kind}
                  active={draft.taskKinds.includes(kind)}
                  onClick={() => update({ taskKinds: toggle(draft.taskKinds, kind) })}
                >
                  {KIND_LABELS[kind]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Workspace domains</Label>
            <div className="flex flex-wrap gap-1.5">
              {DomainSchema.options.map((domain) => (
                <Chip
                  key={domain}
                  active={draft.domains.includes(domain)}
                  onClick={() => update({ domains: toggle(draft.domains, domain) })}
                >
                  {DOMAIN_LABELS[domain]}
                </Chip>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Path globs"
              htmlFor="rule-paths"
              hint="Every target path must match one of them."
            >
              <Textarea
                id="rule-paths"
                className="min-h-20 font-mono text-xs"
                value={draft.pathGlobs}
                onChange={(event) => update({ pathGlobs: event.target.value })}
                placeholder="apps/web/**"
              />
            </Field>
            <Field
              label="Keywords"
              htmlFor="rule-keywords"
              hint="Any of them in the title or prompt."
            >
              <Textarea
                id="rule-keywords"
                className="min-h-20 text-xs"
                value={draft.keywords}
                onChange={(event) => update({ keywords: event.target.value })}
                placeholder="migration, schema"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Max files" htmlFor="rule-max-files">
              <Input
                id="rule-max-files"
                type="number"
                min={0}
                value={draft.maxFilesTouched}
                onChange={(event) => update({ maxFilesTouched: event.target.value })}
              />
            </Field>
            <Field label="Max blast radius" htmlFor="rule-max-blast">
              <Input
                id="rule-max-blast"
                type="number"
                min={0}
                value={draft.maxBlastRadius}
                onChange={(event) => update({ maxBlastRadius: event.target.value })}
              />
            </Field>
            <div className="flex flex-col justify-end gap-2 pb-1 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={draft.styleOnly}
                  onChange={(event) => update({ styleOnly: event.target.checked })}
                />
                Style files only
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--primary)]"
                  checked={draft.enabled}
                  onChange={(event) => update({ enabled: event.target.checked })}
                />
                Enabled
              </label>
            </div>
          </div>
          <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            Matches: <span className="text-foreground">{preview}</span>
          </p>
          <DialogFooter>
            <Button type="submit" disabled={save.isPending || draft.name.trim().length === 0}>
              {save.isPending ? <Loader2 className="animate-spin" /> : null}
              {rule ? "Save rule" : "Create rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RulesPanel({
  initial,
  projects,
  catalog,
}: {
  initial: RoutingRuleDto[];
  projects: ProjectDto[];
  catalog: CatalogResponse;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoutingRuleDto | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKey, setDialogKey] = useState(0);
  const rules = useQuery({
    queryKey: queryKeys.routingRules,
    queryFn: () => api.get<RoutingRuleListResponse>("/api/routing-rules"),
    initialData: { items: initial },
    select: (data) => data.items,
  });
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));

  const patch = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<RoutingRuleDto>(`/api/routing-rules/${id}`, { enabled }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.routingRules }),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/routing-rules/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.routingRules });
      toast.success("Rule deleted");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function openEditor(rule: RoutingRuleDto | null) {
    setEditing(rule);
    setDialogKey((key) => key + 1);
    setDialogOpen(true);
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2">
            <ListChecks className="size-4 text-primary" />
            Rules
          </CardTitle>
          <CardDescription>
            The first enabled rule that matches decides the tier, before the heuristic runs.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => openEditor(null)}>
          <Plus />
          New rule
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border" data-testid="routing-rules">
          {rules.data.map((rule) => (
            <li
              key={rule.id}
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-2 py-3",
                !rule.enabled && "opacity-55",
              )}
            >
              <span className="tabular w-10 shrink-0 font-mono text-xs text-muted-foreground">
                {rule.priority}
              </span>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {rule.name}
                  <Badge>
                    {rule.projectId ? (projectNames.get(rule.projectId) ?? "project") : "global"}
                  </Badge>
                </p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={describeMatcher(rule.matcher)}
                >
                  {describeMatcher(rule.matcher)}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <TierBadge tier={rule.targetTier} />
                {rule.modelId ? <ModelBadge modelId={rule.modelId} /> : null}
              </div>
              <div className="flex items-center gap-1">
                <label className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={rule.enabled}
                    aria-label={`Enable ${rule.name}`}
                    onChange={(event) =>
                      patch.mutate({ id: rule.id, enabled: event.target.checked })
                    }
                  />
                  on
                </label>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${rule.name}`}
                  onClick={() => openEditor(rule)}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${rule.name}`}
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete the rule ${rule.name}?`)) remove.mutate(rule.id);
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {rules.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No rules: the heuristic routes everything.
          </p>
        ) : null}
      </CardContent>
      <RuleDialog
        key={dialogKey}
        rule={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        projects={projects}
        catalog={catalog}
      />
    </Card>
  );
}
