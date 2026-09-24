import {
  computeScheduleTitleInfo,
  formatScheduleTitle,
  type ScheduleTitleTranslateFn,
} from "@/components/schedules/format";
import type { TaskSchedule } from "@/lib/clients/generated/core";
import type { DateTimeFormatter } from "@/lib/schedules/cron";
import type { CoworkerOption } from "@/lib/types/coworker";

/** The Schedules page: every Task Schedule of the workspace. */
export const TASK_SCHEDULES_PATH = "/schedules";

export function taskSchedulePath(scheduleId: string): string {
  return `${TASK_SCHEDULES_PATH}/${scheduleId}`;
}

type TaskScheduleAssigneeFields = Partial<
  Pick<TaskSchedule, "assigneeId" | "assigneeSokoBotId" | "assigneeUserId">
>;

/** The id the assignee picker and option lists use, whatever the kind. */
export function taskScheduleAssigneeId(
  schedule: TaskScheduleAssigneeFields,
): string | null {
  return (
    schedule.assigneeId ??
    schedule.assigneeSokoBotId ??
    schedule.assigneeUserId ??
    null
  );
}

export function taskScheduleAssigneeLabel(
  schedule: TaskScheduleAssigneeFields,
  options: CoworkerOption[],
  labels: { unassigned: string; unavailable: string },
): string {
  const assigneeId = taskScheduleAssigneeId(schedule);
  if (!assigneeId) return labels.unassigned;
  return (
    options.find((option) => option.id === assigneeId)?.name ??
    labels.unavailable
  );
}

/** "Weekly (Monday, 9:00)", in the rule's own time zone. */
export function formatTaskScheduleRule(
  rule: TaskSchedule["rule"],
  formatter: DateTimeFormatter,
  t: ScheduleTitleTranslateFn,
): string {
  return formatScheduleTitle(
    computeScheduleTitleInfo(
      {
        scheduleType: "CRON",
        cron: rule.expr,
        timezone: rule.timezone,
        intervalDays: rule.intervalDays,
      },
      formatter,
    ),
    t,
  );
}
