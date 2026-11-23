"use client";

import type { QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { taskSubtasksQueryKey } from "@/app/tasks/components/use-task-subtasks";
import type { SubtaskRow } from "@/app/tasks/utils/task-subtask-row";

/**
 * Syncs newer server-rendered sub-task rows into the React Query cache for
 * `useTaskSubtasks` when no optimistic mutation is in flight.
 */
export function useTaskSubtasksCacheSync(
  queryClient: QueryClient,
  parentTaskId: string,
  initialRows: SubtaskRow[],
  renderedAt: number,
): void {
  // The cache outlives the page. A refresh brings newer page rows; Back can
  // replay older ones, so only newer rows replace it. A change in flight
  // keeps its optimistic order.
  useEffect(() => {
    const key = taskSubtasksQueryKey(parentTaskId);
    const cachedAt = queryClient.getQueryState(key)?.dataUpdatedAt ?? 0;
    if (
      renderedAt > cachedAt &&
      queryClient.isMutating({ mutationKey: key }) === 0
    )
      queryClient.setQueryData(key, initialRows, {
        updatedAt: renderedAt,
      });
  }, [queryClient, parentTaskId, initialRows, renderedAt]);
}
