"use client";

import type {
  SaveProfileRequest,
  ServerMessage,
  SurgeonStateDto,
  WorkspaceDto,
} from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { presetRules, suggestRules, type Suggestion } from "@onyx/ignore-compiler/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw, Save, ScanSearch } from "lucide-react";
import Link from "next/link";
import { useCallback, useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { FileTree } from "@/components/surgeon/file-tree";
import { CompiledPanel, MeasurePanel } from "@/components/surgeon/policy-tools";
import { ImpactPanel, RulesPanel, SuggestionsPanel } from "@/components/surgeon/side-panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form-controls";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { DOMAIN_LABELS } from "@/lib/domains";
import { useT } from "@/lib/i18n/client";
import {
  centralWarnings,
  composePolicy,
  diffEvaluations,
  directoryStats,
  evaluatePolicy,
  excludeTarget,
  includeTarget,
  parseRuleInput,
  ruleLabel,
  sameRuleSet,
  type PolicyLayers,
  type PolicyRule,
  type SelectionState,
  type TreeNode,
} from "@/lib/surgeon";
import { useChannel } from "@/lib/ws/context";

function scopePath(projectId: string, workspaceId: string | null): string {
  const query = workspaceId === null ? "" : `?workspaceId=${encodeURIComponent(workspaceId)}`;
  return `/api/projects/${projectId}/surgeon${query}`;
}

function toInput(rule: PolicyRule): SaveProfileRequest["rules"][number] {
  return {
    pattern: rule.pattern,
    action: rule.action,
    source: rule.source === "SECURITY" ? "MANUAL" : rule.source,
    reason: rule.reason,
  };
}

function Workbench({
  state,
  workspaceId,
  layerLabel,
  scopeSelect,
}: {
  state: SurgeonStateDto;
  workspaceId: string | null;
  layerLabel: string;
  scopeSelect: (dirty: boolean) => ReactNode;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const projectId = state.projectId;
  const savedEditable = useMemo<PolicyRule[]>(
    () => (workspaceId === null ? state.base.rules : (state.overlay?.rules ?? [])),
    [state, workspaceId],
  );
  const [draft, setDraft] = useState<PolicyRule[] | null>(null);
  const editable = draft ?? savedEditable;
  const deferredEditable = useDeferredValue(editable);
  const layers = useMemo<PolicyLayers>(
    () => ({
      inherited: workspaceId === null ? [] : state.base.rules,
      security: state.securityRules,
    }),
    [state, workspaceId],
  );
  const paths = useMemo(() => state.files.map((file) => file.path), [state.files]);

  const saved = useMemo(
    () => evaluatePolicy(composePolicy(layers, savedEditable), state.files, state.securityRules),
    [layers, savedEditable, state.files, state.securityRules],
  );
  const evaluation = useMemo(
    () =>
      deferredEditable === savedEditable
        ? saved
        : evaluatePolicy(composePolicy(layers, deferredEditable), state.files, state.securityRules),
    [layers, deferredEditable, savedEditable, saved, state.files, state.securityRules],
  );
  const stats = useMemo(
    () => directoryStats(state.files, evaluation, saved),
    [state.files, evaluation, saved],
  );
  const diff = useMemo(
    () => diffEvaluations(state.files, saved, evaluation),
    [state.files, saved, evaluation],
  );
  const warnings = useMemo(
    () => centralWarnings(state.files, saved, evaluation),
    [state.files, saved, evaluation],
  );
  const suggestions = useMemo(
    () =>
      suggestRules(
        state.files.map((file) => ({
          relPath: file.path,
          sizeBytes: file.sizeBytes,
          rawTokens: file.rawTokens,
          binary: file.binary,
          centrality: file.centrality,
        })),
        [...layers.inherited, ...deferredEditable, ...layers.security],
        presetRules("aggressive"),
      ),
    [state.files, layers, deferredEditable],
  );
  const dirty = draft !== null && !sameRuleSet(draft, savedEditable);

  const save = useMutation({
    mutationFn: (rules: PolicyRule[]) =>
      api.put<SurgeonStateDto>(`/api/projects/${projectId}/surgeon`, {
        workspaceId,
        rules: rules.map(toInput),
      } satisfies SaveProfileRequest),
    onSuccess: (next) => {
      queryClient.setQueryData(queryKeys.surgeon(projectId, workspaceId), next);
      setDraft(null);
      const profile = workspaceId === null ? next.base : next.overlay;
      toast.success(t("Context profile saved · v{version}", { version: profile?.version ?? 1 }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onToggle = (node: TreeNode, selection: SelectionState) => {
    if (selection === "locked") return;
    const scope = { ...layers, paths };
    const result =
      selection === "included"
        ? excludeTarget(scope, editable, node.path, node.directory)
        : includeTarget(scope, editable, node.path, node.directory);
    if (!result.exact) {
      toast.warning(
        t("Rules changed, but {path} could not be isolated exactly. Check the diff.", {
          path: node.path,
        }),
      );
    }
    setDraft(result.rules);
  };

  const onAdd = (raw: string): boolean => {
    const rule = parseRuleInput(raw);
    if (rule === null) {
      toast.error(t("Not a valid rule"));
      return false;
    }
    if (editable.some((existing) => ruleLabel(existing) === ruleLabel(rule))) {
      toast.error(t("That rule is already in this layer"));
      return false;
    }
    setDraft([...editable, rule]);
    return true;
  };

  const onApply = (suggestion: Suggestion) =>
    setDraft([...editable, { ...suggestion.rule, locked: false }]);

  const profile = workspaceId === null ? state.base : state.overlay;
  const version = `${state.base.version}:${state.overlay?.version ?? 0}:${state.indexedAt ?? ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {scopeSelect(dirty)}
        <span className="text-xs text-muted-foreground">
          {profile && profile.version > 0 ? `v${profile.version}` : t("not saved yet")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty ? (
            <Badge tone="warning" data-testid="surgeon-dirty">
              {t("unsaved changes")}
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => setDraft(null)}
          >
            <RotateCcw />
            {t("Reset")}
          </Button>
          <Button
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(editable)}
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {t("Save profile")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
        {state.files.length > 0 ? (
          <FileTree
            files={state.files}
            draft={evaluation}
            saved={saved}
            stats={stats}
            onToggle={onToggle}
          />
        ) : (
          <EmptyState
            icon={<ScanSearch className="size-5" />}
            title={t("Not indexed yet")}
            description={t(
              "The tree, heatmap and savings come from the code index. Rules can still be edited.",
            )}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href={`/projects/${projectId}`}>{t("Open the project to index it")}</Link>
              </Button>
            }
          />
        )}
        <div className="min-w-0 space-y-4">
          <ImpactPanel
            draft={evaluation}
            saved={saved}
            diff={diff}
            warnings={warnings}
            pricing={state.pricing}
          />
          <RulesPanel
            layerLabel={layerLabel}
            rules={editable}
            inherited={layers.inherited}
            security={layers.security}
            impact={evaluation.byRule}
            onAdd={onAdd}
            onRemove={(index) => setDraft(editable.filter((_, position) => position !== index))}
          />
          <SuggestionsPanel suggestions={suggestions} onApply={onApply} />
          <MeasurePanel
            projectId={projectId}
            workspaceId={workspaceId}
            calibration={state.calibration}
            dirty={dirty}
            indexed={state.indexedAt !== null}
          />
          <CompiledPanel
            projectId={projectId}
            workspaceId={workspaceId}
            version={version}
            claudesignorePath={state.claudesignorePath}
            claudesignoreExists={state.claudesignoreExists}
          />
        </div>
      </div>
    </div>
  );
}

export function SurgeonWorkbench({
  projectId,
  workspaces,
  initial,
}: {
  projectId: string;
  workspaces: readonly Pick<WorkspaceDto, "id" | "name" | "domain">[];
  initial: SurgeonStateDto;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const { data, error } = useQuery({
    queryKey: queryKeys.surgeon(projectId, workspaceId),
    queryFn: () => api.get<SurgeonStateDto>(scopePath(projectId, workspaceId)),
    ...(workspaceId === null ? { initialData: initial } : {}),
  });

  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === "index.progress" && message.data.state === "ready") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.allSurgeon(projectId) });
      }
    },
    [queryClient, projectId],
  );
  useChannel(channels.project(projectId), onMessage);

  const workspace = workspaces.find((candidate) => candidate.id === workspaceId) ?? null;
  const layerLabel = workspace
    ? t("{name} overlay · on top of the project profile", { name: workspace.name })
    : t("Project profile · every agent");

  const scopeSelect = (dirty: boolean) => (
    <Select
      value={workspaceId ?? ""}
      aria-label={t("Profile scope")}
      className="h-8 w-auto min-w-56 text-xs"
      onChange={(event) => {
        if (dirty && !window.confirm(t("Discard the unsaved changes?"))) return;
        setWorkspaceId(event.target.value === "" ? null : event.target.value);
      }}
    >
      <option value="">{t("Project profile (all workspaces)")}</option>
      {workspaces.map((candidate) => (
        <option key={candidate.id} value={candidate.id}>
          {candidate.name === DOMAIN_LABELS[candidate.domain]
            ? t("{name} overlay", { name: candidate.name })
            : t("{name} overlay · {domain}", {
                name: candidate.name,
                domain: t(DOMAIN_LABELS[candidate.domain]),
              })}
        </option>
      ))}
    </Select>
  );

  if (error) {
    return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-[62vh]" />
      </div>
    );
  }
  return (
    <Workbench
      key={`${workspaceId ?? "project"}`}
      state={data}
      workspaceId={workspaceId}
      layerLabel={layerLabel}
      scopeSelect={scopeSelect}
    />
  );
}
