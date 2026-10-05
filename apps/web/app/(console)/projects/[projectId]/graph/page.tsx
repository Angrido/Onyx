import type { IndexStatusDto } from "@onyx/contracts";
import { Network } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { GraphExplorer } from "@/components/graph/graph-explorer";
import { PageHeader } from "@/components/layout/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Dependency graph") };
}

export default async function ProjectGraphPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const t = await getT();
  const index = await serverFetch<IndexStatusDto>(`/api/projects/${projectId}/index`);

  return (
    <>
      <PageHeader
        title={t("Dependency graph")}
        description={
          <>
            {t(
              "Which files import which: the central files and the circular imports. Agents get the same neighbourhood in their context.",
            )}{" "}
            <HelpTip term="graph" />
          </>
        }
      />
      {index.indexedAt ? (
        <Suspense fallback={<Skeleton className="h-[62vh]" />}>
          <GraphExplorer projectId={projectId} />
        </Suspense>
      ) : (
        <EmptyState
          icon={<Network className="size-5" />}
          title={t("Not indexed yet")}
          description={t(
            "Index the project from Overview, under Configuration, to build the graph.",
          )}
        />
      )}
    </>
  );
}
