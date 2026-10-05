"use client";

import type { MissionControlDto, QueueDto, QuotaDto, ServerMessage } from "@onyx/contracts";
import { channels } from "@onyx/contracts/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { api } from "./api/client";
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

export function useMission(initial?: MissionControlDto) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.mission,
    queryFn: () => api.get<MissionControlDto>("/api/mission-control"),
    refetchInterval: 30_000,
    ...(initial ? { initialData: initial } : {}),
  });
  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === "system.runs" && message.data.event !== "reordered")
        void queryClient.invalidateQueries({ queryKey: queryKeys.mission });
    },
    [queryClient],
  );
  useChannel(channels.system, onMessage);
  return query;
}

export function useQueue(initial?: QueueDto) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.queue,
    queryFn: () => api.get<QueueDto>("/api/queue"),
    ...(initial ? { initialData: initial } : {}),
  });
  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === "system.runs" || message.type === "quota.changed")
        void queryClient.invalidateQueries({ queryKey: queryKeys.queue });
    },
    [queryClient],
  );
  useChannel(channels.system, onMessage);
  return query;
}

export function useQuota(initial?: QuotaDto) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.quota,
    queryFn: () => api.get<QuotaDto>("/api/quota"),
    ...(initial ? { initialData: initial } : {}),
  });
  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.type === "quota.changed")
        queryClient.setQueryData(queryKeys.quota, message.data.quota);
      else if (message.type === "system.runs")
        void queryClient.invalidateQueries({ queryKey: queryKeys.quota });
    },
    [queryClient],
  );
  useChannel(channels.system, onMessage);
  return query;
}
