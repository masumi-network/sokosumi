import "server-only";

import { TaskScheduleState } from "@sokosumi/core-client";
import type { Session } from "@sokosumi/utils";
import { cacheLife } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { loadTaskScheduleAssigneeOptions } from "@/app/tasks/utils/task-schedule-assignee-options";
import { TASK_SCHEDULES_PAGE_LIMIT } from "@/app/tasks/utils/task-schedules-filters";
import { getSession, getSessionResult } from "@/lib/auth/auth.server";
import { CoreAuthUnavailableError } from "@/lib/auth/errors";
import { viewerIsOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { getProjectFilterOptions } from "@/lib/helpers/project-filter-options";
import { PREFETCHED_CONTENT_STALE_SECONDS } from "@/lib/navigation/prefetched-content-stale-time";
import { organizationSeatService } from "@/lib/services/organization-seat.service";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import { userService } from "@/lib/services/user.service";

export interface SchedulesPageDataInput {
  requestedProjectId: string | null;
  state: TaskScheduleState | null;
}

async function readSchedulesPageData(
  { requestedProjectId, state }: SchedulesPageDataInput,
  session: Session | null,
) {
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const [projectOptions, assigneeOptions, canCreate, members] =
    await Promise.all([
      getProjectFilterOptions(requestedProjectId),
      loadTaskScheduleAssigneeOptions(activeOrganizationId),
      organizationSeatService.hasAssignedSeat(activeOrganizationId),
      userService.getMyMembersWithOrganizations(),
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
  // An empty filter says what the other tabs hold, counted by Core.
  const otherStateCounts =
    state && schedules.length === 0
      ? await Promise.all(
          Object.values(TaskScheduleState)
            .filter((other) => other !== state)
            .map(async (other) => ({
              state: other,
              count: await taskScheduleService.countSchedules({
                projectId,
                state: other,
              }),
            })),
        )
      : [];

  return {
    activeOrganizationId,
    projectOptions,
    assigneeOptions,
    canCreate,
    canDeleteUnowned: viewerIsOrganizationOwnerOrAdmin(
      activeOrganizationId,
      members,
    ),
    projectId,
    schedules,
    nextCursor,
    otherStateCounts,
  };
}

type SchedulesPageData = Awaited<ReturnType<typeof readSchedulesPageData>>;

async function readPrivateCachedSchedulesPageData(
  input: SchedulesPageDataInput,
): Promise<SchedulesPageData> {
  "use cache: private";
  cacheLife({ stale: PREFETCHED_CONTENT_STALE_SECONDS });
  const sessionResult = await getSessionResult();
  // Thrown, never cached: an outage must not be kept as "signed out".
  if (sessionResult.isErr()) {
    throw new CoreAuthUnavailableError(sessionResult.error.reason);
  }
  return readSchedulesPageData(input, sessionResult.value);
}

/**
 * The schedules page's Core reads, cached for the browser only, so a link
 * prefetch carries the page. A failed read is never kept: the page then
 * renders fresh on the click, with the same reads uncached.
 */
export function loadSchedulesPageData(
  input: SchedulesPageDataInput,
): Promise<SchedulesPageData> {
  return readPrivateCachedSchedulesPageData(input).catch(
    async (error: unknown) => {
      unstable_rethrow(error);
      await connection();
      return readSchedulesPageData(input, await getSession());
    },
  );
}
