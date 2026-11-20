/** The token a Task Schedule name can hold for its Run's date. */
export const SCHEDULE_TASK_NAME_DATE_TOKEN = "{date}";

function isoDate(at: Date, timeZone: string): string {
  // en-CA formats a date as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
}

/**
 * The name of the Task a Task Schedule Run creates: the schedule's name with
 * each `{date}` replaced by the Run's date (YYYY-MM-DD) in the schedule's time
 * zone. An unknown time zone falls back to UTC.
 */
export function fillScheduleTaskName(
  name: string,
  runAt: Date,
  timeZone: string,
): string {
  if (!name.includes(SCHEDULE_TASK_NAME_DATE_TOKEN)) return name;
  let date: string;
  try {
    date = isoDate(runAt, timeZone);
  } catch {
    date = isoDate(runAt, "UTC");
  }
  return name.replaceAll(SCHEDULE_TASK_NAME_DATE_TOKEN, date);
}
