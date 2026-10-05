"use client";

import type { ResetStrategy, TestRunner, WorkspaceDto } from "@onyx/contracts";
import { RESET_STRATEGIES, TEST_RUNNERS, oneOf } from "@onyx/contracts/client";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Save, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { useT } from "@/lib/i18n/client";
import { splitList } from "@/lib/router";
import { FENCE_LABELS } from "@/components/projects/workspace-grid";
import { RESET_STRATEGY_LABELS } from "@/lib/sessions";

const RUNNER_EXAMPLE = "pnpm --filter web exec vitest";

export function WorkspaceSettings({
  workspace,
  onSaved,
}: {
  workspace: WorkspaceDto;
  onSaved: (workspace: WorkspaceDto) => void;
}) {
  const t = useT();
  const [strategy, setStrategy] = useState<ResetStrategy>(workspace.resetStrategy);
  const [maxTokens, setMaxTokens] = useState(String(workspace.maxSessionTokens));
  const [fence, setFence] = useState(workspace.writeFenceGlobs.join("\n"));
  const [runner, setRunner] = useState<TestRunner | "">(workspace.testRunner ?? "");
  const [testCommand, setTestCommand] = useState(workspace.testCommand ?? "");

  const save = useMutation({
    mutationFn: () =>
      api.patch<WorkspaceDto>(`/api/workspaces/${workspace.id}`, {
        resetStrategy: strategy,
        maxSessionTokens: Number.parseInt(maxTokens, 10),
        writeFenceGlobs: splitList(fence),
        testRunner: runner === "" ? null : runner,
        testCommand: testCommand.trim().length > 0 ? testCommand.trim() : null,
      }),
    onSuccess: (updated) => {
      toast.success(t("{name} saved", { name: updated.name }));
      onSaved(updated);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings2 className="size-4 text-primary" />
          {t("Compartment")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label={t("Reset strategy")}
              htmlFor="ws-strategy"
              hint={t(RESET_STRATEGY_LABELS[strategy].hint)}
            >
              <Select
                id="ws-strategy"
                value={strategy}
                onChange={(event) =>
                  setStrategy(oneOf(RESET_STRATEGIES, event.target.value) ?? strategy)
                }
              >
                {RESET_STRATEGIES.map((option) => (
                  <option key={option} value={option}>
                    {t(FENCE_LABELS[option])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("Max session tokens")}
              htmlFor="ws-max-tokens"
              hint={t("Above it, runs rotate and terminals compact.")}
            >
              <Input
                id="ws-max-tokens"
                type="number"
                min={10_000}
                max={1_000_000}
                step={1_000}
                value={maxTokens}
                onChange={(event) => setMaxTokens(event.target.value)}
              />
            </Field>
          </div>
          <Field
            label={t("Write fence")}
            htmlFor="ws-fence"
            hint={t(
              "Globs this workspace may edit. Files claimed by another workspace stay read-only; unclaimed files stay editable.",
            )}
          >
            <Textarea
              id="ws-fence"
              className="min-h-20 font-mono text-xs"
              value={fence}
              onChange={(event) => setFence(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <Field label={t("Test runner")} htmlFor="ws-runner" hint={t("Used by the TDD loop.")}>
              <Select
                id="ws-runner"
                value={runner}
                onChange={(event) =>
                  setRunner(
                    event.target.value === ""
                      ? ""
                      : (oneOf(TEST_RUNNERS, event.target.value) ?? ""),
                  )
                }
              >
                <option value="">{t("Detect")}</option>
                {TEST_RUNNERS.map((option) => (
                  <option key={option} value={option}>
                    {option === "VITEST" ? "Vitest" : "Jest"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t("Runner command")}
              htmlFor="ws-test-command"
              hint={t("How to call the runner, without arguments. Empty uses node_modules/.bin.")}
            >
              <Input
                id="ws-test-command"
                className="font-mono text-xs"
                placeholder={RUNNER_EXAMPLE}
                value={testCommand}
                onChange={(event) => setTestCommand(event.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {t("Save")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
