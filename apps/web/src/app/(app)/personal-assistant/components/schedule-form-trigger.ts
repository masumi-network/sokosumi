/**
 * New schedule's id. A deleted row's dialog returns focus here, since the
 * row and its Delete button are gone.
 */
export const SCHEDULE_FORM_TRIGGER_ID = "soko-bot-new-schedule";

/** Moves focus to New schedule; false when the page has none. */
export function focusScheduleFormTrigger(): boolean {
  const trigger = document.getElementById(SCHEDULE_FORM_TRIGGER_ID);
  trigger?.focus();
  return trigger !== null;
}
