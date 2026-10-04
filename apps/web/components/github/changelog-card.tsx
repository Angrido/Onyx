"use client";

import type { ChangelogPreviewDto, SaveChangelogResponse } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Loader2, RefreshCw, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { CHANGELOG_SECTION_LABELS } from "@/lib/github";
import { useT } from "@/lib/i18n/client";

function ReleaseForm({ projectId, preview }: { projectId: string; preview: ChangelogPreviewDto }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [version, setVersion] = useState(preview.version);
  const [markdown, setMarkdown] = useState(preview.markdown);
  const save = useMutation({
    mutationFn: () =>
      api.post<SaveChangelogResponse>(`/api/projects/${projectId}/changelog`, {
        version,
        markdown,
      }),
    onSuccess: (saved) => {
      toast.success(
        t("{version} is in {file}: publish it with the next changes", {
          version: saved.release.version,
          file: saved.file,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.changelog(projectId) });
      void queryClient.invalidateQueries({ queryKey: ["git", projectId] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form className="space-y-3" onSubmit={submit} data-testid="changelog-form">
      <Field label={t("Version")} htmlFor="changelog-version">
        <Input
          id="changelog-version"
          className="max-w-48 font-mono"
          value={version}
          onChange={(event) => setVersion(event.target.value)}
        />
      </Field>
      <Field
        label={t("Release notes")}
        htmlFor="changelog-markdown"
        hint={
          preview.fileExists
            ? t("Added at the top of {file}. Edit freely.", { file: preview.file })
            : t("Added at the top of {file}, which will be created. Edit freely.", {
                file: preview.file,
              })
        }
      >
        <Textarea
          id="changelog-markdown"
          className="min-h-56 font-mono text-xs"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
        />
      </Field>
      <Button
        type="submit"
        disabled={save.isPending || version.trim().length === 0 || markdown.trim().length === 0}
        data-testid="changelog-save"
      >
        {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
        {t("Save to {file}", { file: preview.file })}
      </Button>
    </form>
  );
}

export function ChangelogCard({
  projectId,
  initial,
}: {
  projectId: string;
  initial: ChangelogPreviewDto;
}) {
  const t = useT();
  const preview = useQuery({
    queryKey: queryKeys.changelog(projectId),
    queryFn: () => api.get<ChangelogPreviewDto>(`/api/projects/${projectId}/changelog`),
    initialData: initial,
  });
  const data = preview.data;

  return (
    <Card data-testid="changelog">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="size-4 text-primary" />
          {t("Changelog")}
        </CardTitle>
        <CardDescription>
          {data.fromLabel
            ? t("Since {label}", { label: data.fromLabel })
            : t("From the first commit")}
          :{" "}
          {t("{commits} and {tasks}.", {
            commits:
              data.commits === 1 ? t("1 commit") : t("{count} commits", { count: data.commits }),
            tasks:
              data.tasks === 1
                ? t("1 completed task")
                : t("{count} completed tasks", { count: data.tasks }),
          })}{" "}
          {t("Conventional Commits go under their section; chores, CI and tests are left out.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void preview.refetch()}
            disabled={preview.isFetching}
          >
            {preview.isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {t("Read again")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {data.entries.length === 1
              ? t("1 entry")
              : t("{count} entries", { count: data.entries.length })}
          </span>
        </div>
        {data.entries.length > 0 ? (
          <ul className="space-y-1.5 text-sm" aria-label={t("Changelog entries")}>
            {data.entries.map((entry) => (
              <li
                key={`${entry.source}-${entry.ref}`}
                className="flex flex-wrap items-center gap-2"
              >
                <Badge tone={entry.section === "BREAKING" ? "danger" : "neutral"}>
                  {t(CHANGELOG_SECTION_LABELS[entry.section])}
                </Badge>
                <span>
                  {entry.scope ? <span className="font-medium">{entry.scope}: </span> : null}
                  {entry.text}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {entry.source === "TASK" ? t("task") : entry.ref}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <ReleaseForm
          key={`${data.toRef}:${preview.dataUpdatedAt}`}
          projectId={projectId}
          preview={data}
        />
        {data.releases.length > 0 ? (
          <div className="space-y-1.5 border-t border-border pt-4">
            <h3 className="text-sm font-semibold">{t("Saved releases")}</h3>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.releases.map((release) => (
                <li key={release.id}>
                  <span className="font-mono text-foreground">{release.version}</span> ·{" "}
                  {t("up to")} <span className="font-mono">{release.toRef.slice(0, 7)}</span> ·{" "}
                  <RelativeTime iso={release.createdAt} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
