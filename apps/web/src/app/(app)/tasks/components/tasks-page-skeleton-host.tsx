"use client";

import { useSyncExternalStore } from "react";
import { TasksPageSkeleton } from "@/app/tasks/components/tasks-loading-view";
import { readTasksToolbarHeight } from "@/app/tasks/components/tasks-toolbar-height";
import { parseTasksDensityCookieHeader } from "@/lib/ui-preferences/tasks-density";
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

function getClientCompact(): boolean {
  return parseTasksDensityCookieHeader(document.cookie) === "compact";
}

/**
 * Normal size on the server render. A compact user sees one redraw at
 * hydration, the same trade-off as view mode: `loading.tsx` must not read
 * cookies (Instant Nav).
 */
function getServerCompact(): boolean {
  return false;
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

  const compact = useSyncExternalStore(
    subscribe,
    getClientCompact,
    getServerCompact,
  );

  // The server has no window: the skeleton's own toolbar height until hydration.
  const toolbarMinHeight = useSyncExternalStore(
    subscribe,
    readTasksToolbarHeight,
    () => null,
  );

  return (
    <TasksPageSkeleton
      viewMode={viewMode}
      compact={compact}
      toolbarMinHeight={toolbarMinHeight}
    />
  );
}
