import "server-only";

import { getCoworkerOptions } from "@/app/tasks/utils/coworker-options";
import { listTaskAssigneeMemberOptions } from "@/app/tasks/utils/task-assignee-members";
import { TaskStatus } from "@/lib/clients/generated/core";
import {
  getCalendarRange,
  getLatestCalendarDate,
  resolveCalendarDate,
} from "@/lib/schedules/calendar-range";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";

export function resolveCalendarPageQuery(
  date: string | undefined,
  status: string | undefined,
) {
  const calendarStatus = Object.values(TaskStatus).find(
    (taskStatus) => taskStatus === status,
  );
  const now = new Date();
  const latestCalendarDate = getLatestCalendarDate(now);
  const initialDate = resolveCalendarDate(date, now);
  const range = getCalendarRange(initialDate);

  return { calendarStatus, latestCalendarDate, initialDate, range };
}

export async function loadCalendarPageContext(
  activeOrganizationId: string | null,
) {
  const [sources, coworkers, memberOptions] = await Promise.all([
    taskService.getWorkspaceCalendarSources().catch(() => []),
    coworkerService.listCoworkers().catch(() => []),
    listTaskAssigneeMemberOptions(activeOrganizationId),
  ]);

  return {
    sources,
    coworkerOptions: [...memberOptions, ...getCoworkerOptions(coworkers)],
  };
}
