import type { LogListResponse } from "@onyx/contracts";
import { Stethoscope } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { LogViewer } from "@/components/system/log-viewer";
import { Button } from "@/components/ui/button";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";
import { DEFAULT_LOG_FILTER, logsPath } from "@/lib/system";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Logs") };
}

export default async function LogsPage() {
  const t = await getT();
  const initial = await serverFetch<LogListResponse>(logsPath(DEFAULT_LOG_FILTER));
  return (
    <>
      <PageHeader
        eyebrow={t("System")}
        title={t("Logs")}
        description={t(
          "The last {count} lines written by the Onyx API, kept in memory with secrets masked. They start over when Onyx restarts.",
          { count: initial.capacity },
        )}
        actions={
          <Button asChild variant="secondary">
            <Link href="/settings#diagnostics">
              <Stethoscope />
              {t("Diagnostics")}
            </Link>
          </Button>
        }
      />
      <LogViewer initial={initial} />
    </>
  );
}
