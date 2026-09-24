import type { Metadata } from "next";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { TaskSchedulesView } from "@/app/tasks/components/task-schedules-view";
import { listTaskScheduleAssigneeDisplayOptions } from "@/app/tasks/utils/task-schedule-assignee-options";
import {
  parseTaskScheduleStateFilter,
  TASK_SCHEDULES_PAGE_LIMIT,
} from "@/app/tasks/utils/task-schedules-filters";
import { firstQueryString } from "@/app/tasks/utils/tasks-filters";
import { getSession } from "@/lib/auth/auth.server";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";

import SchedulesLoading from "./loading";

interface SchedulesPageProps {
  searchParams: Promise<{
    projectId?: string | string[];
    scheduleState?: string | string[];
  }>;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Tasks.Schedules.Page");

  return {
    title: t("title"),
    description: t("description"),
  };
}

/** Every Task Schedule of the workspace, filtered by project and state. */
export default function SchedulesPage({ searchParams }: SchedulesPageProps) {
  return (
    <Suspense fallback={<SchedulesLoading />}>
      <SchedulesPageContent searchParams={searchParams} />
    </Suspense>
  );
}

export async function SchedulesPageContent({
  searchParams,
}: SchedulesPageProps) {
  await connection();
  const [params, session] = await Promise.all([searchParams, getSession()]);
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const requestedProjectId = firstQueryString(params.projectId) ?? null;
  const state = parseTaskScheduleStateFilter(params.scheduleState);
  const [projectOptions, coworkerOptions, canCreate] = await Promise.all([
    getProjectFilterOptions(requestedProjectId),
    listTaskScheduleAssigneeDisplayOptions(activeOrganizationId),
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
        coworkerOptions={coworkerOptions}
        projectOptions={projectOptions}
        selectedProjectId={projectId}
        selectedState={state}
        canCreate={canCreate}
        canCreatePrivate={activeOrganizationId !== null}
      />
    </div>
  );
}
