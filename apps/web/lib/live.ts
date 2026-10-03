"use client";

import { channels } from "@onyx/contracts/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { queryKeys } from "./api/keys";
import { useChannel } from "./ws/context";

export function useLiveProject(projectId: string): void {
  const queryClient = useQueryClient();
  const onMessage = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
    void queryClient.invalidateQueries({ queryKey: queryKeys.project(projectId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.orchestrations(projectId) });
  }, [queryClient, projectId]);
  useChannel(channels.project(projectId), onMessage);
}

export function useLiveTask(taskId: string): void {
  const queryClient = useQueryClient();
  const onMessage = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.tddLoops(taskId) });
  }, [queryClient, taskId]);
  useChannel(channels.task(taskId), onMessage);
}

export function useLiveSystem(): void {
  const queryClient = useQueryClient();
  const onMessage = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.telemetry });
    void queryClient.invalidateQueries({ queryKey: queryKeys.allTasks });
  }, [queryClient]);
  useChannel(channels.system, onMessage);
}
