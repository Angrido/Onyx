"use client";

import type { MemoryFactDto, ProjectMemoryDto, UpdateMemoryFactRequest } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  Check,
  Loader2,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatTokens } from "@/lib/format";
import {
  FACT_KIND_LABELS,
  FACT_KIND_TONES,
  budgetShare,
  factSource,
  groupFacts,
} from "@/lib/memory";

function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, index) =>
        index % 2 === 1 ? (
          <code key={index} className="rounded bg-surface-2 px-1 font-mono text-[12px]">
            {part}
          </code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function FactRow({
  fact,
  busy,
  onUpdate,
  onRemove,
  actions,
}: {
  fact: MemoryFactDto;
  busy: boolean;
  onUpdate: (input: UpdateMemoryFactRequest) => void;
  onRemove: () => void;
  actions?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.line);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    onUpdate({ text: text.length > 0 && text !== fact.line ? text : null });
    setEditing(false);
  }

  return (
    <li className="space-y-1.5 py-3" data-testid="memory-fact">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={FACT_KIND_TONES[fact.kind]}>{FACT_KIND_LABELS[fact.kind]}</Badge>
        {fact.status === "ACTIVE" ? (
          fact.included ? (
            <Badge tone="success">in memory</Badge>
          ) : (
            <Badge>over the limit</Badge>
          )
        ) : null}
        {fact.pinned ? <Badge tone="primary">pinned</Badge> : null}
        {fact.text && fact.kind !== "NOTE" ? <Badge>edited</Badge> : null}
      </div>
      {editing ? (
        <form className="flex items-center gap-2" onSubmit={save}>
          <Input
            aria-label="Fact text"
            value={draft}
            maxLength={300}
            onChange={(event) => setDraft(event.target.value)}
            className="h-9 flex-1"
            autoFocus
          />
          <Button size="icon" type="submit" aria-label="Save the fact" className="size-9">
            <Check />
          </Button>
          <Button
            size="icon"
            type="button"
            variant="ghost"
            aria-label="Cancel editing"
            className="size-9"
            onClick={() => setEditing(false)}
          >
            <X />
          </Button>
        </form>
      ) : (
        <p className="break-words text-sm">
          <Inline text={fact.line} />
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {fact.sourceRunId ? (
            <Link
              href={`/runs/${fact.sourceRunId}`}
              className="hover:text-foreground hover:underline"
            >
              {factSource(fact)}
            </Link>
          ) : (
            factSource(fact)
          )}
          {fact.expiresAt
            ? ` · forgotten after ${fact.expiresAt.slice(0, 10)} unless seen again`
            : ""}
        </p>
        <div className="flex items-center gap-1">
          {actions}
          {fact.status === "ACTIVE" ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={busy}
                aria-label={fact.pinned ? "Unpin the fact" : "Pin the fact"}
                title={fact.pinned ? "Unpin" : "Pin: always first, never forgotten"}
                onClick={() => onUpdate({ pinned: !fact.pinned })}
              >
                {fact.pinned ? <PinOff /> : <Pin />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="size-8"
                disabled={busy}
                aria-label="Edit the fact"
                onClick={() => {
                  setDraft(fact.line);
                  setEditing(true);
                }}
              >
                <Pencil />
              </Button>
            </>
          ) : null}
          {fact.status !== "DISMISSED" ? (
            <Button
              size="icon"
              variant="ghost"
              className="size-8"
              disabled={busy}
              aria-label={fact.kind === "NOTE" ? "Delete the note" : "Forget the fact"}
              title={fact.kind === "NOTE" ? "Delete" : "Forget: it will not come back"}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function MemoryPanel({ initial }: { initial: ProjectMemoryDto }) {
  const queryClient = useQueryClient();
  const key = queryKeys.memory(initial.projectId);
  const { data: memory = initial } = useQuery({
    queryKey: key,
    queryFn: () => api.get<ProjectMemoryDto>(`/api/projects/${initial.projectId}/memory`),
    initialData: initial,
  });
  const [note, setNote] = useState("");
  const store = (next: ProjectMemoryDto) => queryClient.setQueryData(key, next);
  const base = `/api/projects/${memory.projectId}/memory`;

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateMemoryFactRequest }) =>
      api.patch<ProjectMemoryDto>(`${base}/facts/${id}`, input),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<ProjectMemoryDto>(`${base}/facts/${id}`),
    onSuccess: store,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const add = useMutation({
    mutationFn: (text: string) => api.post<ProjectMemoryDto>(`${base}/notes`, { text }),
    onSuccess: (next) => {
      store(next);
      setNote("");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const groups = groupFacts(memory.facts);
  const busy = update.isPending || remove.isPending;
  const share = budgetShare(memory.preview?.tokens ?? 0, memory.settings.budgetTokens);
  const row = (fact: MemoryFactDto, actions?: ReactNode) => (
    <FactRow
      key={fact.id}
      fact={fact}
      busy={busy}
      onUpdate={(input) => update.mutate({ id: fact.id, input })}
      onRemove={() => remove.mutate(fact.id)}
      {...(actions ? { actions } : {})}
    />
  );

  return (
    <div className="space-y-6">
      <Card data-testid="memory-preview">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Brain className="size-4 text-primary" />
            What new sessions start with
            {!memory.settings.enabled ? <Badge tone="warning">off</Badge> : null}
          </CardTitle>
          <CardDescription>
            Onyx collects facts from the runs of this project (commands that work, files read in
            many tasks, test commands that went green, failures that repeat) and adds the active
            ones to the system prompt of each new session, up to {memory.settings.budgetTokens}{" "}
            tokens. A session keeps the memory it started with, so resumes stay cached.{" "}
            <Link href="/settings#memory" className="text-primary hover:underline">
              Settings
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
              <span className="text-muted-foreground" data-testid="memory-usage">
                {memory.preview
                  ? `${memory.preview.included} ${memory.preview.included === 1 ? "fact" : "facts"} · ${formatTokens(memory.preview.tokens)} of ${formatTokens(memory.settings.budgetTokens)} tokens${memory.preview.omitted > 0 ? ` · ${memory.preview.omitted} left out by the limit` : ""}`
                  : "Nothing yet: facts appear after the first runs."}
              </span>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-surface-3"
              role="meter"
              aria-label="Memory size against its limit"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}
            >
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${share * 100}%` }}
              />
            </div>
          </div>
          {memory.preview ? (
            <details className="rounded-lg border border-border bg-surface-0/60 p-3">
              <summary className="cursor-pointer text-xs font-medium">Show the text</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[12px] text-muted-foreground">
                {memory.preview.text}
              </pre>
            </details>
          ) : null}
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (note.trim().length >= 3) add.mutate(note.trim());
            }}
          >
            <Input
              aria-label="Add a note to the memory"
              placeholder="Add a note, e.g. Prices are stored in cents"
              value={note}
              maxLength={300}
              onChange={(event) => setNote(event.target.value)}
              className="h-9 min-w-0 flex-1"
              data-testid="memory-note"
            />
            <Button size="sm" disabled={add.isPending || note.trim().length < 3}>
              {add.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Add note
            </Button>
          </form>
        </CardContent>
      </Card>

      {groups.suggested.length > 0 ? (
        <Card data-testid="memory-suggested">
          <CardHeader>
            <CardTitle>To confirm</CardTitle>
            <CardDescription>
              Failures seen in more than one run. They enter the memory only if you confirm them,
              because the text comes from command output.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {groups.suggested.map((fact) =>
                row(
                  fact,
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => update.mutate({ id: fact.id, input: { status: "ACTIVE" } })}
                  >
                    <Check />
                    Confirm
                  </Button>,
                ),
              )}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card data-testid="memory-active">
        <CardHeader>
          <CardTitle>Remembered</CardTitle>
          <CardDescription>
            Facts not seen again for {memory.settings.expiryDays} days are forgotten, unless pinned.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {groups.active.length > 0 ? (
            <ul className="divide-y divide-border">{groups.active.map((fact) => row(fact))}</ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nothing remembered yet. Run a few tasks: commands that work show up after the first
              run, key files after three.
            </p>
          )}
        </CardContent>
      </Card>

      {groups.dismissed.length > 0 ? (
        <details className="rounded-xl border border-border p-4" data-testid="memory-dismissed">
          <summary className="cursor-pointer text-sm font-medium">
            Forgotten ({groups.dismissed.length})
          </summary>
          <ul className="mt-2 divide-y divide-border">
            {groups.dismissed.map((fact) =>
              row(
                fact,
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => update.mutate({ id: fact.id, input: { status: "ACTIVE" } })}
                >
                  <RotateCcw />
                  Restore
                </Button>,
              ),
            )}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
