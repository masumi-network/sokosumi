export const TaskScheduleEndsMode = {
  NEVER: "never",
  ON: "on",
  AFTER: "after",
} as const;

export type TaskScheduleEndsMode =
  (typeof TaskScheduleEndsMode)[keyof typeof TaskScheduleEndsMode];

/** What the schedule form holds: a repeating rule (ADR 0041). */
export interface TaskScheduleSelection {
  timezone: string;
  firstRunLocalIso?: string;
  cron?: string;
  customCronExpr?: string;
  intervalDays?: number;
  endsMode?: TaskScheduleEndsMode;
  endOnLocalDate?: string;
  endAfterOccurrences?: number;
}
