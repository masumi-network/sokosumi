export const TaskScheduleEndsMode = {
  NEVER: "never",
  ON: "on",
  AFTER: "after",
} as const;

export type TaskScheduleEndsMode =
  (typeof TaskScheduleEndsMode)[keyof typeof TaskScheduleEndsMode];

export type TaskScheduleMode = "none" | "now" | "once" | "recurring";

export interface TaskScheduleSelection {
  mode: TaskScheduleMode;
  timezone: string;
  oneTimeLocalIso?: string;
  cron?: string;
  customCronExpr?: string;
  intervalDays?: number;
  endsMode?: TaskScheduleEndsMode;
  endOnLocalDate?: string;
  endAfterOccurrences?: number;
}
