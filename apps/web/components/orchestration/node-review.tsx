"use client";

import type { MergeResolutionDto, QaReviewDto } from "@onyx/contracts";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatUsd } from "@/lib/format";
import {
  QA_VERDICT_LABELS,
  QA_VERDICT_TONES,
  RESOLUTION_LABELS,
  RESOLUTION_TONES,
} from "@/lib/orchestration";
import { cn } from "@/lib/utils";

export function NodeReview({ review, reviews }: { review: QaReviewDto; reviews: number }) {
  return (
    <details
      className="group rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs"
      data-testid="node-review"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5">
        <Badge tone={QA_VERDICT_TONES[review.verdict]}>{QA_VERDICT_LABELS[review.verdict]}</Badge>
        <span className="text-muted-foreground">
          {reviews === 1 ? "1 review" : `${reviews} reviews`}
          {review.costUsd !== null ? ` · ${formatUsd(review.costUsd)}` : ""}
          {review.diffTruncated ? " · diff shortened" : ""}
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        {review.summary ? <p className="text-muted-foreground">{review.summary}</p> : null}
        {review.criteria.length > 0 ? (
          <ul className="space-y-1">
            {review.criteria.map((criterion) => (
              <li key={criterion.index} className="flex gap-1.5">
                {criterion.met ? (
                  <Check className="mt-0.5 size-3 shrink-0 text-success" aria-label="met" />
                ) : (
                  <X className="mt-0.5 size-3 shrink-0 text-destructive" aria-label="not met" />
                )}
                <span>
                  {criterion.text}
                  <span className="block font-mono text-xs text-muted-foreground">
                    {criterion.evidence}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {review.issues.length > 0 ? (
          <ul className="list-disc space-y-0.5 pl-4 text-warning">
            {review.issues.map((issue, index) => (
              <li key={index}>
                {issue.file ? <span className="font-mono">{issue.file}: </span> : null}
                {issue.problem}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function diffLineClass(line: string): string {
  if (line.startsWith("@@")) return "text-architect";
  if (/^[ +]{0,2}\+/.test(line) && !line.startsWith("+++")) return "text-success";
  if (/^[ -]{0,2}-/.test(line) && !line.startsWith("---")) return "text-destructive";
  return "text-muted-foreground";
}

export function NodeResolution({ resolution }: { resolution: MergeResolutionDto }) {
  return (
    <details
      className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs"
      open={resolution.state === "PROPOSED"}
      data-testid="node-resolution"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5">
        <Badge tone={RESOLUTION_TONES[resolution.state]}>
          {RESOLUTION_LABELS[resolution.state]}
        </Badge>
        <span className="text-muted-foreground">
          {resolution.files.join(", ")}
          {resolution.costUsd !== null ? ` · ${formatUsd(resolution.costUsd)}` : ""}
        </span>
      </summary>
      <div className="mt-2 space-y-2">
        {resolution.checks ? (
          <p
            className={cn(
              resolution.checksPassed === false ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {resolution.checks}
          </p>
        ) : null}
        {resolution.message ? <p className="text-warning">{resolution.message}</p> : null}
        {resolution.diff ? (
          <pre
            className="max-h-72 overflow-auto rounded border border-border bg-background p-2 font-mono text-xs leading-relaxed"
            tabIndex={0}
            aria-label="Proposed resolution diff"
          >
            {resolution.diff.split("\n").map((line, index) => (
              <span key={index} className={cn("block whitespace-pre", diffLineClass(line))}>
                {line || " "}
              </span>
            ))}
          </pre>
        ) : null}
      </div>
    </details>
  );
}
