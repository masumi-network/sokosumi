"use client";

import type { GetTasksResponse } from "@sokosumi/core-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  mapTaskListItemToTaskPickerTask,
  type TaskPickerTask,
} from "@/app/tasks/components/task-detail-api-types";
import { coreClient } from "@/lib/clients/core.browser.client";

const TASK_PICKER_PAGE_SIZE = 20;

export interface UseTaskLinkPickerTasksOptions {
  taskId: string;
  debouncedQuery: string;
  includeSubtasks: boolean;
  excludeTaskIds: readonly string[];
  tDetailActions: (
    key: "taskPickerError" | "taskPickerLoadMoreError",
  ) => string;
}

export interface UseTaskLinkPickerTasksResult {
  results: TaskPickerTask[];
  nextCursor: string | null;
  error: string | null;
  isLoading: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

/**
 * Loads and paginates linkable tasks for `TaskLinkTaskPickerDialog` whenever
 * `debouncedQuery` changes, dropping stale responses by request id.
 */
export function useTaskLinkPickerTasks({
  taskId,
  debouncedQuery,
  includeSubtasks,
  excludeTaskIds,
  tDetailActions,
}: UseTaskLinkPickerTasksOptions): UseTaskLinkPickerTasksResult {
  const [results, setResults] = useState<TaskPickerTask[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const requestIdRef = useRef(0);

  async function loadTasks({
    query,
    cursor,
    append,
  }: {
    query: string;
    cursor?: string | null;
    append: boolean;
  }) {
    const requestId = ++requestIdRef.current;

    if (append) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }

    setError(null);

    try {
      const response = (await coreClient.getTasks({
        q: query || undefined,
        cursor: cursor ?? undefined,
        limit: TASK_PICKER_PAGE_SIZE,
        ...(includeSubtasks ? { includeSubtasks: "true" as const } : {}),
      })) as GetTasksResponse;

      if (requestId !== requestIdRef.current) {
        return;
      }

      const nextTasks = response.data
        .map(mapTaskListItemToTaskPickerTask)
        .filter(
          (taskOption) =>
            taskOption.id !== taskId && !excludeTaskIds.includes(taskOption.id),
        );

      setResults((currentResults) =>
        append ? [...currentResults, ...nextTasks] : nextTasks,
      );
      setNextCursor(response.meta?.pagination?.nextCursor ?? null);
    } catch (_error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      const message = append
        ? tDetailActions("taskPickerLoadMoreError")
        : tDetailActions("taskPickerError");

      if (!append) {
        setResults([]);
        setNextCursor(null);
      }

      setError(message);
    } finally {
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (append) {
        setIsLoadingMore(false);
      } else {
        setIsLoading(false);
      }
    }
  }

  const loadInitialTasks = useEffectEvent((query: string) => {
    void loadTasks({ query, append: false });
  });

  useEffect(() => {
    loadInitialTasks(debouncedQuery);
  }, [debouncedQuery]);

  function loadMore() {
    if (!nextCursor || isLoadingMore || isLoading) {
      return;
    }

    void loadTasks({
      query: debouncedQuery,
      cursor: nextCursor,
      append: true,
    });
  }

  return {
    results,
    nextCursor,
    error,
    isLoading,
    isLoadingMore,
    loadMore,
  };
}
