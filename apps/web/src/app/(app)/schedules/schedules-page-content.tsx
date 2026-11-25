import { cookies } from "next/headers";

import { TaskSchedulesView } from "@/app/tasks/components/task-schedules-view";
import { parseTaskScheduleStateFilter } from "@/app/tasks/utils/task-schedules-filters";
import { firstQueryString } from "@/app/tasks/utils/tasks-filters";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";

import {
  parseSchedulesViewMode,
  SCHEDULES_VIEW_MODE_COOKIE_NAME,
} from "@/lib/ui-preferences/schedules-view-mode";

import { loadSchedulesPageData } from "./schedules-page-data";

export interface SchedulesSearchParams {
  projectId?: string | string[];
  scheduleState?: string | string[];
}

export async function SchedulesPageContent({
  searchParams,
}: {
  searchParams: Promise<SchedulesSearchParams>;
}) {
  const params = await searchParams;
  const cookieStore = await cookies();
  const defaultViewMode = parseSchedulesViewMode(
    cookieStore.get(SCHEDULES_VIEW_MODE_COOKIE_NAME)?.value,
  );
  const state = parseTaskScheduleStateFilter(params.scheduleState);
  const {
    activeOrganizationId,
    viewerId,
    projectOptions,
    assigneeOptions,
    canCreate,
    canDeleteUnowned,
    projectId,
    schedules,
    nextCursor,
    otherStateCounts,
  } = await loadSchedulesPageData({
    requestedProjectId: firstQueryString(params.projectId) ?? null,
    state,
  });

  return (
    <div className="w-full pb-6">
      <RefreshPrefetchedPage />
      <TaskSchedulesView
        // A new filter starts a new first page, so appended pages reset.
        key={`${projectId ?? ""}:${state ?? ""}`}
        defaultViewMode={defaultViewMode}
        schedules={schedules}
        nextCursor={nextCursor}
        otherStateCounts={otherStateCounts}
        coworkerOptions={assigneeOptions.selectableOptions}
        assigneeDisplayOptions={assigneeOptions.displayOptions}
        projectOptions={projectOptions}
        selectedProjectId={projectId}
        selectedState={state}
        canCreate={canCreate}
        canCreatePrivate={activeOrganizationId !== null}
        viewerId={viewerId}
        canDeleteUnowned={canDeleteUnowned}
      />
    </div>
  );
}
