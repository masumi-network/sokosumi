/** The token a Task Schedule name can hold for its Run's date. */
export const SCHEDULE_TASK_NAME_DATE_TOKEN = "{date}";

/** Core's Task name limit, in UTF-16 code units like Zod's `.max()`. */
export const SCHEDULE_TASK_NAME_MAX_LENGTH = 10_000;

/** A date is always YYYY-MM-DD: ten characters. */
const DATE_LENGTH = 10;

function isoDate(at: Date, timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return [
    parts.year.padStart(4, "0"),
    parts.month.padStart(2, "0"),
    parts.day.padStart(2, "0"),
  ].join("-");
}

/**
 * The name of the Task a Task Schedule Run creates: the schedule's name with
 * each `{date}` replaced by the Run's date (YYYY-MM-DD) in the schedule's time
 * zone. An unknown time zone falls back to UTC. A name saved before its
 * filled length was checked is cut at the Task name limit, never inside a
 * character.
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
  const filled = name.replaceAll(SCHEDULE_TASK_NAME_DATE_TOKEN, date);
  if (filled.length <= SCHEDULE_TASK_NAME_MAX_LENGTH) return filled;
  const cut = filled.slice(0, SCHEDULE_TASK_NAME_MAX_LENGTH);
  // Drop a high surrogate whose pair the cut left behind.
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/** How long the Task name made from this schedule name is, whatever the date. */
export function scheduleTaskNameLength(name: string): number {
  const tokens = name.split(SCHEDULE_TASK_NAME_DATE_TOKEN).length - 1;
  return (
    name.length + tokens * (DATE_LENGTH - SCHEDULE_TASK_NAME_DATE_TOKEN.length)
  );
}
