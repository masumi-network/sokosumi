"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { SubtaskRow } from "@/app/tasks/utils/task-subtask-row";

/**
 * Syncs newer server-rendered sub-task rows into the React Query cache for
 * `useTaskSubtasks` when no optimistic mutation is in flight.
 */
export function useTaskSubtasksCacheSync(
  queryClient: QueryClient,
  queryKey: readonly ["task-subtasks", string],
  initialRows: SubtaskRow[],
  renderedAt: number,
): void {
  const parentTaskId = queryKey[1];
  // The cache outlives the page. A refresh brings newer page rows; Back can
  // replay older ones, so only newer rows replace it. A change in flight
  // keeps its optimistic order.
  useEffect(() => {
    const cachedAt = queryClient.getQueryState(queryKey)?.dataUpdatedAt ?? 0;
    if (
      renderedAt > cachedAt &&
      queryClient.isMutating({ mutationKey: queryKey }) === 0
    )
      queryClient.setQueryData(queryKey, initialRows, {
        updatedAt: renderedAt,
      });
  }, [queryClient, parentTaskId, initialRows, renderedAt]);
}
