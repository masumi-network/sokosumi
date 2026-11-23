"use client";

import type { TaskSchedule, TaskScheduleState } from "@sokosumi/core-client";
import type { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";
import { loadMoreTaskSchedules } from "@/app/tasks/actions";
import type { TaskSchedulesPage } from "@/lib/services/task-schedule.service";

type TaskSchedulesRouter = Pick<ReturnType<typeof useRouter>, "refresh">;

export interface UseTaskSchedulesPaginationOptions {
  schedules: TaskSchedule[];
  nextCursor: string | null;
  selectedProjectId: string | null;
  selectedState: TaskScheduleState | null;
  searching: boolean;
  router: TaskSchedulesRouter;
}

export interface UseTaskSchedulesPaginationResult {
  loaded: TaskSchedule[];
  nextCursor: string | null;
  isRefreshing: boolean;
  isLoadingMore: boolean;
  hasFailed: boolean;
  handleScheduleChanged: () => void;
  handleLoadMore: () => void;
}

/**
 * Owns `TaskSchedulesView` pagination state, refresh invalidation, and
 * search-driven auto-paging across remaining cursor pages.
 */
export function useTaskSchedulesPagination({
  schedules,
  nextCursor,
  selectedProjectId,
  selectedState,
  searching,
  router,
}: UseTaskSchedulesPaginationOptions): UseTaskSchedulesPaginationResult {
  const [more, setMore] = useState<TaskSchedulesPage | null>(null);
  const additionalPage = more ?? { schedules: [], nextCursor };
  const pageGeneration = useRef(0);
  const [isRefreshing, startRefreshing] = useTransition();
  const [isLoadingMore, startLoadingMore] = useTransition();
  const [hasFailed, setHasFailed] = useState(false);

  function handleScheduleChanged() {
    pageGeneration.current += 1;
    setHasFailed(false);
    startRefreshing(() => {
      setMore(null);
      router.refresh();
    });
  }

  function handleLoadMore() {
    const cursor = additionalPage.nextCursor;
    if (!cursor || isRefreshing || isLoadingMore) return;
    const generation = pageGeneration.current;
    setHasFailed(false);
    startLoadingMore(async () => {
      try {
        const page = await loadMoreTaskSchedules({
          cursor,
          projectId: selectedProjectId,
          state: selectedState,
        });
        if (generation !== pageGeneration.current) return;
        setMore((current) => ({
          schedules: [...(current?.schedules ?? []), ...page.schedules],
          nextCursor: page.nextCursor,
        }));
      } catch {
        // Stop loading on its own until the reader asks again, rather than
        // hammering a server that just said no.
        if (generation === pageGeneration.current) setHasFailed(true);
      }
    });
  }

  // A refresh can bring back rows a "Load more" already appended.
  const loaded = [
    ...schedules,
    ...additionalPage.schedules.filter(
      (extra) => !schedules.some((row) => row.id === extra.id),
    ),
  ];

  const searchNextPage = useEffectEvent(handleLoadMore);
  const searchCursor =
    searching && !hasFailed && !isLoadingMore && !isRefreshing
      ? additionalPage.nextCursor
      : null;
  useEffect(() => {
    if (searchCursor) searchNextPage();
  }, [searchCursor]);

  return {
    loaded,
    nextCursor: additionalPage.nextCursor,
    isRefreshing,
    isLoadingMore,
    hasFailed,
    handleScheduleChanged,
    handleLoadMore,
  };
}
