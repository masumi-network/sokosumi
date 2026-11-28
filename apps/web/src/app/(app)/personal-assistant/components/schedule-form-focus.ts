/**
 * Where the schedule form takes focus: New schedule while it is closed, its
 * Name field while it is open. Only one of them is mounted, so one id serves
 * both. A deleted row's dialog returns focus here, since the row and its
 * Delete button are gone.
 */
export const SCHEDULE_FORM_FOCUS_ID = "soko-bot-schedule-form-focus";

/** Moves focus to the schedule form; false when the page has none. */
export function focusScheduleForm(): boolean {
  const target = document.getElementById(SCHEDULE_FORM_FOCUS_ID);
  target?.focus();
  return target !== null;
}
