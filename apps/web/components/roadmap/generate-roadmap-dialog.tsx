"use client";

import type { CatalogResponse, RoadmapGenerationDto, RoadmapLanguage } from "@onyx/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Map as MapIcon, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ModelSelect } from "@/components/tasks/model-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/form-controls";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";

function browserLanguage(): RoadmapLanguage {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("it") ? "it" : "en";
}

export function GenerateRoadmapDialog({
  projectId,
  catalog,
  running,
  hasSuggestions,
}: {
  projectId: string;
  catalog: CatalogResponse;
  running: boolean;
  hasSuggestions: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [language, setLanguage] = useState<RoadmapLanguage>(browserLanguage);
  const [focus, setFocus] = useState("");
  const [model, setModel] = useState("");

  const generate = useMutation({
    mutationFn: () =>
      api.post<RoadmapGenerationDto>(`/api/projects/${projectId}/roadmap`, {
        language,
        ...(focus.trim() ? { focus: focus.trim() } : {}),
        ...(model ? { modelId: model } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.board(projectId) });
      setOpen(false);
      toast.info("Claude is studying the project");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    generate.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={running}>
          {running ? <Loader2 className="animate-spin" /> : <MapIcon />}
          {running ? "Studying the project…" : "Roadmap"}
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,34rem)]">
        <DialogHeader>
          <DialogTitle>Suggest a roadmap</DialogTitle>
          <DialogDescription>
            Claude reads the project index, README, manifests, TODO notes and recent commits, then
            explores the code read-only and proposes the next tasks.
            {hasSuggestions ? " Current suggestions you have not accepted are replaced." : ""}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Language" htmlFor="roadmap-language">
              <Select
                id="roadmap-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value === "it" ? "it" : "en")}
              >
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label="Model" htmlFor="roadmap-model">
              <ModelSelect
                id="roadmap-model"
                models={catalog.models}
                value={model}
                onChange={setModel}
                defaultLabel="Architect tier"
              />
            </Field>
          </div>
          <Field
            label="Focus"
            htmlFor="roadmap-focus"
            hint="Optional: what matters most right now, e.g. security before the launch, or mobile layout."
          >
            <Textarea
              id="roadmap-focus"
              className="min-h-20"
              value={focus}
              onChange={(event) => setFocus(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button type="submit" disabled={generate.isPending}>
              {generate.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Study and suggest
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
