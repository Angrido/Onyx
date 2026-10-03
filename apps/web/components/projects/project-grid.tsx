"use client";

import type { ProjectDto, ProjectListResponse } from "@onyx/contracts";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { FolderGit2 } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/skeleton";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/keys";
import { RelativeTime } from "@/components/ui/relative-time";

export function ProjectGrid({
  initial,
  emptyAction,
}: {
  initial: ProjectDto[];
  emptyAction: ReactNode;
}) {
  const { data } = useQuery({
    queryKey: queryKeys.projects,
    queryFn: async () => (await api.get<ProjectListResponse>("/api/projects")).items,
    initialData: initial,
  });

  if (data.length === 0) {
    return (
      <EmptyState
        icon={<FolderGit2 className="size-5" />}
        title="No projects registered"
        description="Register a repository to start orchestrating agents on it."
        action={emptyAction}
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {data.map((project, index) => (
        <motion.div
          key={project.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.04, duration: 0.3 }}
        >
          <Link href={`/projects/${project.id}`}>
            <Card className="group h-full p-5 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-border-strong">
              <div className="flex items-start justify-between gap-3">
                <div className="rounded-lg border border-border bg-surface-2 p-2 text-primary">
                  <FolderGit2 className="size-4" />
                </div>
                <RelativeTime iso={project.updatedAt} className="text-xs text-muted-foreground" />
              </div>
              <p className="mt-4 text-base font-semibold tracking-tight">{project.name}</p>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {project.rootPath}
              </p>
              <div className="mt-4 flex gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="tabular font-medium text-foreground">
                    {project.workspaceCount}
                  </span>{" "}
                  workspaces
                </span>
                <span>
                  <span className="tabular font-medium text-foreground">{project.taskCount}</span>{" "}
                  tasks
                </span>
              </div>
            </Card>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}
