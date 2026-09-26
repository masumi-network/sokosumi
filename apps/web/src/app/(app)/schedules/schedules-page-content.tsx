import { connection } from "next/server";

import { TaskSchedulesView } from "@/app/tasks/components/task-schedules-view";
import { loadTaskScheduleAssigneeOptions } from "@/app/tasks/utils/task-schedule-assignee-options";
import {
  parseTaskScheduleStateFilter,
  TASK_SCHEDULES_PAGE_LIMIT,
} from "@/app/tasks/utils/task-schedules-filters";
import { firstQueryString } from "@/app/tasks/utils/tasks-filters";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";

export interface SchedulesSearchParams {
  projectId?: string | string[];
  scheduleState?: string | string[];
}

export async function SchedulesPageContent({
  searchParams,
}: {
  searchParams: Promise<SchedulesSearchParams>;
}) {
  await connection();
  const [params, session] = await Promise.all([searchParams, getSession()]);
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const requestedProjectId = firstQueryString(params.projectId) ?? null;
  const state = parseTaskScheduleStateFilter(params.scheduleState);
  const [projectOptions, assigneeOptions, canCreate] = await Promise.all([
    getProjectFilterOptions(requestedProjectId),
    loadTaskScheduleAssigneeOptions(activeOrganizationId),
    organizationSeatService.hasAssignedSeat(activeOrganizationId),
  ]);
  const projectId = projectOptions.some(
    (project) => project.id === requestedProjectId,
  )
    ? requestedProjectId
    : null;
  const { schedules, nextCursor } = await taskScheduleService.listSchedules({
    projectId,
    state,
    limit: TASK_SCHEDULES_PAGE_LIMIT,
  });

  return (
    <div className="w-full pb-6">
      <TaskSchedulesView
        // A new filter starts a new first page, so appended pages reset.
        key={`${projectId ?? ""}:${state ?? ""}`}
        schedules={schedules}
        nextCursor={nextCursor}
        coworkerOptions={assigneeOptions.selectableOptions}
        assigneeDisplayOptions={assigneeOptions.displayOptions}
        projectOptions={projectOptions}
        selectedProjectId={projectId}
        selectedState={state}
        canCreate={canCreate}
        canCreatePrivate={activeOrganizationId !== null}
        currentUserId={session?.user.id ?? null}
      />
    </div>
  );
}
