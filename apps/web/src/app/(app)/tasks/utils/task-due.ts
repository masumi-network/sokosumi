import type { TaskStatus } from "@/lib/types/core-dto";

/** Work that ended on purpose; a due date no longer presses on it. */
const FINISHED_STATUSES: readonly TaskStatus[] = ["COMPLETED", "CANCELED"];

/** The calendar day `now` falls on in `timeZone`, as `YYYY-MM-DD`. */
export function dayInTimeZone(now: Date, timeZone?: string): string {
  // en-CA writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Past its due day (`today` is the reader's day), and not yet finished. */
export function isTaskOverdue(
  dueOn: string,
  status: TaskStatus,
  today: string,
): boolean {
  return !FINISHED_STATUSES.includes(status) && dueOn < today;
}

/**
 * Noon UTC of the due day. Format it with `DUE_DAY_FORMAT`, which reads it in
 * UTC, so the shown day never shifts with the server's or reader's zone.
 */
export function dueDayDate(dueOn: string): Date {
  return new Date(`${dueOn}T12:00:00.000Z`);
}

export const DUE_DAY_FORMAT = {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
} as const;
