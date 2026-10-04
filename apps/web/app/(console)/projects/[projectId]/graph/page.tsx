import type { IndexStatusDto, ProjectDetailDto } from "@onyx/contracts";
import { Network } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { GraphExplorer } from "@/components/graph/graph-explorer";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, Skeleton } from "@/components/ui/skeleton";
import { serverFetch } from "@/lib/api/server";
import { getT } from "@/lib/i18n/server";

export default async function ProjectGraphPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const t = await getT();
  const [project, index] = await Promise.all([
    serverFetch<ProjectDetailDto>(`/api/projects/${projectId}`),
    serverFetch<IndexStatusDto>(`/api/projects/${projectId}/index`),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/projects/${project.id}`} className="hover:text-foreground">
            ← {project.name}
          </Link>
        }
        title={t("Dependency graph")}
        description={t(
          "Import graph built by Graphify from tree-sitter. Agents receive the same neighbourhood as skeletons in their context pack.",
        )}
      />
      {index.indexedAt ? (
        <Suspense fallback={<Skeleton className="h-[62vh]" />}>
          <GraphExplorer projectId={project.id} />
        </Suspense>
      ) : (
        <EmptyState
          icon={<Network className="size-5" />}
          title={t("Not indexed yet")}
          description={t("Index the project from its page to build the graph.")}
        />
      )}
    </>
  );
}
