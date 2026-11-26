/**
 * Whether a schedule's brief, the owner's words, asks its run to end it
 * ("delete this schedule once Mira is done", "turn this schedule off when it
 * ships", "lösche den Zeitplan, sobald es fertig ist"). A brief without such
 * words never ends its schedule, and a negated one ("never delete this
 * schedule", "lösche den Zeitplan nicht") forbids it rather than asking.
 * Shared by the run's prompt and the guard on its tools, so both agree.
 */

const SCHEDULE_NOUN =
  "(schedule|check-?ins?|checks?|reminders?|follow-?ups?|watch|zeitplan|erinnerung\\w*)";
const DETERMINER = "(this|the|that|it|diese[nrs]?|den|die|das)?";

const ASKS_TO_END = new RegExp(
  [
    // "delete this schedule", "stop the check-ins", "lösche den Zeitplan"
    `\\b(delete|remove|stop|cancel|end|turn off|switch off|disable|pause|lösch\\w*|entfern\\w*|beend\\w*|stopp\\w*)\\b[^.!?\\n]{0,60}\\b${DETERMINER}\\s*${SCHEDULE_NOUN}\\b`,
    // "turn this schedule off", "schalte den Zeitplan ab"
    `\\b(turn|switch|shut|schalte?)\\b\\s+${DETERMINER}\\s*${SCHEDULE_NOUN}\\s+(off|down|ab|aus)\\b`,
  ].join("|"),
  "gi",
);
/** Negation shortly before the verb, in the same sentence. */
const NEGATED_BEFORE =
  /\b(never|not|don'?t|doesn'?t|do not|must not|mustn'?t|nie|niemals|nicht|kein\w*)\b[^.!?\n]{0,20}$/i;
/** German negates after the object: "lösche diesen Zeitplan nicht". */
const NEGATED_AFTER = /^[^.!?\n]{0,15}\b(nicht|nie|niemals)\b/i;
const NEGATION_INSIDE = /\b(never|not|don'?t|nicht|nie|niemals)\b/i;

export function briefAsksToEnd(prompt: string): boolean {
  for (const match of prompt.matchAll(ASKS_TO_END)) {
    const before = prompt.slice(Math.max(0, match.index - 40), match.index);
    const after = prompt.slice(match.index + match[0].length);
    if (
      !NEGATED_BEFORE.test(before) &&
      !NEGATION_INSIDE.test(match[0]) &&
      !NEGATED_AFTER.test(after)
    )
      return true;
  }
  return false;
}
