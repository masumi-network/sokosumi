"use client";

import { useTranslations } from "next-intl";
import { Suspense, useSyncExternalStore } from "react";
import { TasksLoadingView } from "@/app/tasks/components/tasks-loading-view";
import { effectiveTasksSort } from "@/app/tasks/utils/task-sort";
import { getTasksFiltersFromSearchParams } from "@/app/tasks/utils/tasks-filters";
import {
  parseTasksDensityCookieHeader,
  type TasksDensity,
} from "@/lib/ui-preferences/tasks-density";
import {
  DEFAULT_TASKS_VIEW_MODE_DESKTOP,
  resolveTasksViewModeFromClientCookie,
  type TasksViewMode,
} from "@/lib/ui-preferences/tasks-view-mode";

import { useTasksSearchParams } from "./tasks-search-params";
import { buildTasksViewLabels } from "./tasks-view-labels";
import { TasksViewToolbarActions } from "./tasks-view-toolbar-actions";

const subscribe = () => () => {};
const ignore = () => {};

/**
 * Stands in for the viewer: the view switcher needs one to show, and the
 * shell must show it. Nothing private reaches the shell.
 */
const PENDING_VIEWER_ID = "pending-viewer";

function getClientViewMode(): TasksViewMode {
  return resolveTasksViewModeFromClientCookie(
    document.cookie,
    navigator.userAgent,
  );
}

function getServerViewMode(): TasksViewMode {
  return DEFAULT_TASKS_VIEW_MODE_DESKTOP;
}

function getClientDensity(): TasksDensity {
  return parseTasksDensityCookieHeader(document.cookie) ?? "normal";
}

/**
 * Normal size on the server render. A compact user sees one redraw at
 * hydration, the same trade-off as view mode: `loading.tsx` must not read
 * cookies (Instant Nav).
 */
function getServerDensity(): TasksDensity {
  return "normal";
}

/**
 * The board's real toolbar, drawn from the URL while the board loads: the
 * view, search, filter chips and menus take their final size and labels, so
 * the columns below open where they stay. Inert until the board replaces it.
 * It knows no workspace: chips that name a coworker or tag of the workspace
 * wait for the board, and it sends no request of its own.
 */
function TasksToolbarShell({
  viewMode,
  density,
  labels,
}: {
  viewMode: TasksViewMode;
  density: TasksDensity;
  labels: ReturnType<typeof buildTasksViewLabels>;
}) {
  const searchParams = useTasksSearchParams();
  const filters = getTasksFiltersFromSearchParams(searchParams, null, []);
  const sort = effectiveTasksSort(filters.sort, viewMode, filters.scope);

  return (
    <div inert className="flex min-w-0 flex-1">
      <TasksViewToolbarActions
        filters={{
          activeOrganizationId: null,
          userId: PENDING_VIEWER_ID,
          pending: true,
          coworkerOptions: [],
          projectOptions: [],
          labels: { ...labels.filters, columns: labels.columns },
        }}
        display={{
          value: viewMode,
          onChange: ignore,
          density,
          onDensityChange: ignore,
          sort,
          onSortChange: ignore,
          showSubtasks: filters.subtasks === true,
          onShowSubtasksChange: ignore,
          labels: labels.display,
        }}
        exportFilters={{ ...filters, sort }}
      />
    </div>
  );
}

/**
 * Instant Nav / Suspense host: resolves view mode from cookie + UA on the
 * client without calling cookies()/connection() in loading.tsx.
 */
export function TasksPageSkeletonHost() {
  const t = useTranslations("App.Tasks");
  const labels = buildTasksViewLabels(t);
  const viewMode = useSyncExternalStore(
    subscribe,
    getClientViewMode,
    getServerViewMode,
  );
  const density = useSyncExternalStore(
    subscribe,
    getClientDensity,
    getServerDensity,
  );

  return (
    // The toolbar reads the URL, which suspends while Next prerenders a
    // static shell. The whole shell waits with it: a static shell draws no
    // board rather than columns without their toolbar, which would drop when
    // the toolbar arrives. A request-time render and a client navigation
    // draw it at once.
    <Suspense fallback={null}>
      <div className="w-full">
        <TasksLoadingView
          viewMode={viewMode}
          compact={density === "compact"}
          labels={labels}
          toolbar={
            <TasksToolbarShell
              viewMode={viewMode}
              density={density}
              labels={labels}
            />
          }
        />
      </div>
    </Suspense>
  );
}
