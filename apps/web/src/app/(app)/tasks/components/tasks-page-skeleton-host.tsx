"use client";

import { useSyncExternalStore } from "react";
import { TasksPageSkeleton } from "@/app/tasks/components/tasks-loading-view";
import {
  DEFAULT_TASKS_VIEW_MODE_DESKTOP,
  resolveTasksViewModeFromClientCookie,
  type TasksViewMode,
} from "@/lib/ui-preferences/tasks-view-mode";

const subscribe = () => () => {};

function getClientViewMode(): TasksViewMode {
  return resolveTasksViewModeFromClientCookie(
    document.cookie,
    navigator.userAgent,
  );
}

function getServerViewMode(): TasksViewMode {
  return DEFAULT_TASKS_VIEW_MODE_DESKTOP;
}

/**
 * Instant Nav / Suspense host: resolves view mode from cookie + UA on the
 * client without calling cookies()/connection() in loading.tsx.
 */
export function TasksPageSkeletonHost() {
  const viewMode = useSyncExternalStore(
    subscribe,
    getClientViewMode,
    getServerViewMode,
  );

  return <TasksPageSkeleton viewMode={viewMode} />;
}
