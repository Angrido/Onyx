"use client";

import type { InsightDto, InsightListResponse } from "@onyx/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageSquareText, Search, Sparkles } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AnswerText } from "@/components/insights/answer-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/form-controls";
import { RelativeTime } from "@/components/ui/relative-time";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { formatTokens, formatUsd } from "@/lib/format";
import { EXAMPLE_QUESTIONS, INTENT_LABELS, MODE_LABELS, MODE_TONES } from "@/lib/insights";

function InsightCard({
  insight,
  asking,
  onAskModel,
}: {
  insight: InsightDto;
  asking: boolean;
  onAskModel: () => void;
}) {
  return (
    <li className="space-y-2 border-b border-border py-4 last:border-b-0" data-testid="insight">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{insight.question}</p>
        <Badge tone={MODE_TONES[insight.mode]}>{MODE_LABELS[insight.mode]}</Badge>
        <Badge>{INTENT_LABELS[insight.intent]}</Badge>
        <span className="text-xs text-muted-foreground">
          {insight.mode === "MODEL"
            ? `${insight.costUsd !== null ? formatUsd(insight.costUsd) : "cost unknown"}${insight.tokens !== null ? ` · ${formatTokens(insight.tokens)} tokens` : ""} · `
            : ""}
          <RelativeTime iso={insight.createdAt} />
        </span>
      </div>
      <AnswerText text={insight.answer} />
      {insight.mode === "INDEX" ? (
        <Button size="sm" variant="ghost" onClick={onAskModel} disabled={asking}>
          {asking ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Ask Claude instead
        </Button>
      ) : null}
    </li>
  );
}

export function InsightsPanel({
  projectId,
  initial,
}: {
  projectId: string;
  initial: InsightListResponse;
}) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const { data } = useQuery({
    queryKey: queryKeys.insights(projectId),
    queryFn: () => api.get<InsightListResponse>(`/api/projects/${projectId}/insights`),
    initialData: initial,
  });
  const ask = useMutation({
    mutationFn: (input: { question: string; useModel: boolean }) =>
      api.post<InsightDto>(`/api/projects/${projectId}/insights`, input),
    onSuccess: (answer) => {
      setQuestion("");
      if (answer.mode === "MODEL")
        toast.success(`Claude answered for ${formatUsd(answer.costUsd ?? 0)}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.insights(projectId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.savings });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.trim().length >= 3) ask.mutate({ question: question.trim(), useModel: false });
  }

  const total = data.indexAnswers + data.modelAnswers;
  return (
    <Card data-testid="insights">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquareText className="size-4 text-primary" />
          Ask about the code
        </CardTitle>
        <CardDescription>
          Definitions, usages, imports, central and large files and import cycles are answered from
          the project index, for free and with their sources. Other questions go to Claude Haiku in
          read-only mode, with the cost shown.
          {total > 0 ? ` ${data.indexAnswers} of ${total} answers so far came from the index.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
          <label htmlFor="insight-question" className="sr-only">
            Question
          </label>
          <Input
            id="insight-question"
            value={question}
            maxLength={500}
            placeholder="Where is `formatPrice` used?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <Button
            type="submit"
            disabled={ask.isPending || question.trim().length < 3}
            data-testid="insight-ask"
          >
            {ask.isPending ? <Loader2 className="animate-spin" /> : <Search />}
            Ask
          </Button>
        </form>
        {!data.indexed ? (
          <p className="text-sm text-warning">
            The project is not indexed yet: every question goes to Claude until the index is ready.
          </p>
        ) : null}
        {data.items.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Try:
            {EXAMPLE_QUESTIONS.map((example) => (
              <Button
                key={example}
                size="sm"
                variant="secondary"
                onClick={() => ask.mutate({ question: example, useModel: false })}
                disabled={ask.isPending}
              >
                {example.replaceAll("`", "")}
              </Button>
            ))}
          </div>
        ) : (
          <ul>
            {data.items.map((insight) => (
              <InsightCard
                key={insight.id}
                insight={insight}
                asking={ask.isPending}
                onAskModel={() => ask.mutate({ question: insight.question, useModel: true })}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
