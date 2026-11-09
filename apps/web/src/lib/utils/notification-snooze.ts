/** Hour a "morning" snooze comes back, in the reader's own time zone. */
const MORNING_HOUR = 9;

export type SnoozePreset = "hour" | "tomorrow" | "nextWeek";

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  "hour",
  "tomorrow",
  "nextWeek",
];

/** When a snooze chosen at `now` ends: in an hour, tomorrow 9:00, or next Monday 9:00. */
export function snoozeUntil(preset: SnoozePreset, now: Date): Date {
  if (preset === "hour") return new Date(now.getTime() + 60 * 60 * 1000);

  const until = new Date(now);
  until.setHours(MORNING_HOUR, 0, 0, 0);
  // Sunday is 0: days to the next Monday, a full week when today is Monday.
  const days = preset === "tomorrow" ? 1 : (8 - now.getDay()) % 7 || 7;
  until.setDate(until.getDate() + days);
  return until;
}
