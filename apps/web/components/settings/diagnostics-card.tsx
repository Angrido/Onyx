"use client";

import type { DiagnosticsBundle } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, Loader2, RefreshCw, ScrollText, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, errorMessage } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { useT } from "@/lib/i18n/client";
import { diagnosticsFacts, diagnosticsFileName } from "@/lib/system";

function save(bundle: DiagnosticsBundle): void {
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = diagnosticsFileName(bundle.generatedAt);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function DiagnosticsCard() {
  const t = useT();
  const [requested, setRequested] = useState(false);
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: queryKeys.diagnostics,
    queryFn: () => api.get<DiagnosticsBundle>("/api/diagnostics"),
    enabled: requested,
    staleTime: Infinity,
  });

  return (
    <Card id="diagnostics" data-testid="diagnostics-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Stethoscope className="size-4 text-primary" aria-hidden />
          {t("Diagnostics")}
        </CardTitle>
        <CardDescription>
          {t(
            "One file to send when you ask for help: versions, configuration without secrets, readiness, recent warnings and errors, database and queue figures. Check the preview, then download exactly what you see.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <>
              <Button onClick={() => save(data)} data-testid="diagnostics-download">
                <Download />
                {t("Download the file")}
              </Button>
              <Button variant="secondary" onClick={() => void refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {t("Prepare again")}
              </Button>
            </>
          ) : (
            <Button
              onClick={() => setRequested(true)}
              disabled={isFetching}
              data-testid="diagnostics-preview"
            >
              {isFetching ? <Loader2 className="animate-spin" /> : <Eye />}
              {t("Preview the diagnostics")}
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href="/logs">
              <ScrollText />
              {t("Open the logs")}
            </Link>
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(error, t)}
          </p>
        ) : null}
        {data ? (
          <div className="space-y-3" data-testid="diagnostics-summary">
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-[auto_1fr]">
              {diagnosticsFacts(data, t).map((fact) => (
                <div key={fact.label} className="contents">
                  <dt className="text-muted-foreground">{fact.label}</dt>
                  <dd className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>
            <details>
              <summary className="w-fit cursor-pointer rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {t("Show the whole file")}
              </summary>
              <pre
                role="region"
                aria-label={t("Diagnostics file")}
                tabIndex={0}
                className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-surface-1 p-3 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {JSON.stringify(data, null, 2)}
              </pre>
            </details>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t(
              "Nothing is sent anywhere: the file is prepared on this Onyx and saved by your browser.",
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
