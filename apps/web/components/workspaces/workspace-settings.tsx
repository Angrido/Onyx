"use client";

import { ResetStrategySchema, type ResetStrategy, type WorkspaceDto } from "@onyx/contracts";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Save, Settings2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { splitList } from "@/lib/router";
import { RESET_STRATEGY_LABELS } from "@/lib/sessions";

export function WorkspaceSettings({
  workspace,
  onSaved,
}: {
  workspace: WorkspaceDto;
  onSaved: (workspace: WorkspaceDto) => void;
}) {
  const [strategy, setStrategy] = useState<ResetStrategy>(workspace.resetStrategy);
  const [maxTokens, setMaxTokens] = useState(String(workspace.maxSessionTokens));
  const [fence, setFence] = useState(workspace.writeFenceGlobs.join("\n"));

  const save = useMutation({
    mutationFn: () =>
      api.patch<WorkspaceDto>(`/api/workspaces/${workspace.id}`, {
        resetStrategy: strategy,
        maxSessionTokens: Number.parseInt(maxTokens, 10),
        writeFenceGlobs: splitList(fence),
      }),
    onSuccess: (updated) => {
      toast.success(`${updated.name} saved`);
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
          Compartment
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-3" onSubmit={submit}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Reset strategy"
              htmlFor="ws-strategy"
              hint={RESET_STRATEGY_LABELS[strategy].hint}
            >
              <Select
                id="ws-strategy"
                value={strategy}
                onChange={(event) => setStrategy(ResetStrategySchema.parse(event.target.value))}
              >
                {ResetStrategySchema.options.map((option) => (
                  <option key={option} value={option}>
                    {RESET_STRATEGY_LABELS[option].label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Max session tokens"
              htmlFor="ws-max-tokens"
              hint="Above it, runs rotate and terminals compact."
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
            label="Write fence"
            htmlFor="ws-fence"
            hint="Globs this workspace may edit. Files claimed by another workspace stay read-only; unclaimed files stay editable."
          >
            <Textarea
              id="ws-fence"
              className="min-h-20 font-mono text-xs"
              value={fence}
              onChange={(event) => setFence(event.target.value)}
            />
          </Field>
          <Button type="submit" size="sm" disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Save
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
