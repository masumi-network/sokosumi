/**
 * A background run keeps working until it says it is done. Cheaper models end
 * the loop with a progress note after the first batch ("this is only a
 * partial start…") although hours remain; each note is answered with this
 * nudge instead of being taken as the report.
 */
export const KEEP_GOING_PROMPT =
  "Check the brief against what you have actually finished. If a step of the brief is left, keep working on it now with your tools; do not report yet. Do not look for work the brief did not ask for. When every step is done, or the rest is impossible, write your final report now and start it with DONE:";

/** Most nudges a run gets; the step and time budgets usually end it first. */
export const MAX_KEEP_GOING_ROUNDS = 40;

/** Stop nudging when less than this is left: the report needs time too. */
export const MIN_ROUND_TIME_MS = 3 * 60 * 1_000;

/**
 * A run stops working this long before its deadline and writes its report:
 * a six-hour YC run was still calling tools when it was cut off, so the owner
 * got "ran out of time" and none of the work.
 */
export const REPORT_RESERVE_MS = 5 * 60 * 1_000;

export const TIME_UP_PROMPT =
  "Your time or step budget is used up; you cannot call tools any more. Write your final report now from what you have: start it with DONE:, say what you finished, link what you made and saved, and name what is left undone so the owner can pick it up.";

/** "DONE:", also as a heading, in bold or after a check mark. */
const DONE_PREFIX = /^[\s#>*_\-–—✅✔\uFE0F]*DONE\b[\s*_:–—-]*/iu;

/** Rounds in a row that only looked things up before the reply counts as the report. */
export const MAX_IDLE_ROUNDS = 2;

const READ_TOOL =
  /^(get|list|read|search|find)_|^(refresh_context|preview_result|read_memory|workspace_read|workspace_list|workspace_search)$/;

/**
 * A round that only re-read Tasks and Files: the work is done and the model
 * is checking it again. Waiting on a Coworker runs \`bash\` \`sleep\`, so it
 * never counts; a v25 run re-listed the same Tasks for twenty minutes after
 * the review came back because its reply never started with DONE.
 */
export function isIdleRound(toolNames: readonly string[]): boolean {
  return toolNames.every((name) => READ_TOOL.test(name));
}

export function isFinalReport(text: string): boolean {
  return DONE_PREFIX.test(text);
}

/** The report as the owner should read it, without the marker. */
export function reportText(text: string): string {
  return text.replace(DONE_PREFIX, "").trim();
}
