import { TaskScheduleState } from "@/lib/clients/generated/core";

export const TASK_SCHEDULE_STATE_PARAM = "scheduleState";

export const TASK_SCHEDULES_PAGE_LIMIT = 50;

export function parseTaskScheduleStateFilter(
  raw: string | string[] | null | undefined,
): TaskScheduleState | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (
    Object.values(TaskScheduleState).find((state) => state === value) ?? null
  );
}
