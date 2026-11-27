/**
 * A background run keeps working until it says it is done. Cheaper models end
 * the loop with a progress note after the first batch ("this is only a
 * partial start…") although hours remain; each note is answered with this
 * nudge instead of being taken as the report.
 */
export const KEEP_GOING_PROMPT =
  "Check the brief against what you have actually finished. If a step of the brief is left, keep working on it now with your tools; do not report yet. Do not look for work the brief did not ask for. When every step is done, or the rest is impossible, write your final report now and start it with DONE:";

/**
 * Most nudges a run gets. Each nudged round resends the whole context, so a
 * run that still has work after eight is better ended with its report.
 */
export const MAX_KEEP_GOING_ROUNDS = 8;

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

/**
 * A turn that is not a background run stops this long before its deadline
 * (at most a fifth of its time) and answers from what it has, instead of
 * being cut off mid-tool with no reply.
 */
export const FOREGROUND_REPORT_RESERVE_MS = 60 * 1_000;

export const FOREGROUND_TIME_UP_PROMPT =
  "Your time or step budget for this turn is used up; you cannot call tools any more. Answer now from what you have: say what you did, what you found, and what is left undone.";

/** "DONE:", also as a heading, in bold or after a check mark. */
const DONE_PREFIX = /^[\s#>*_\-–—✅✔\uFE0F]*DONE\b[\s*_:–—-]*/iu;

/** Rounds in a row that only looked things up before the reply counts as the report. */
export const MAX_IDLE_ROUNDS = 2;

const READ_TOOL =
  /^(get|list|read|search|find|count)_|^(refresh_context|preview_result|read_memory|read_skill|read_writing_skill|workspace_read|workspace_list|workspace_search)$/;

/** A shell command that only waits: `sleep 60`, `sleep 5m; sleep 5m`. */
const SLEEP_ONLY =
  /^\s*sleep\s+[\d.]+[smhd]?\s*((;|&&)\s*sleep\s+[\d.]+[smhd]?\s*)*;?\s*$/;

export interface RoundToolCall {
  toolName: string;
  input: unknown;
}

export function isReadOnlyToolName(toolName: string): boolean {
  return READ_TOOL.test(toolName);
}

export function isSleepOnlyToolCall(call: RoundToolCall): boolean {
  if (call.toolName !== "bash") return false;
  const command =
    typeof call.input === "object" &&
    call.input !== null &&
    "command" in call.input
      ? call.input.command
      : undefined;
  return typeof command === "string" && SLEEP_ONLY.test(command);
}

/**
 * A round that only re-read Tasks and Files, or slept: the work is done and
 * the model is checking it again or waiting. A v25 run re-listed the same
 * Tasks for twenty minutes after the review came back because its reply never
 * started with DONE; a wait belongs to wait_for, which wakes the bot when the
 * work is back.
 */
export function isIdleRound(calls: readonly RoundToolCall[]): boolean {
  return calls.every(
    (call) => isReadOnlyToolName(call.toolName) || isSleepOnlyToolCall(call),
  );
}

/**
 * A turn that could act answers in a JSON narrative, so its DONE is at the
 * start of `message`. Missing it nudged a finished follow-up into a second
 * round whose "Shared Hannah's reply." replaced the reply itself.
 */
function narrativeOf(text: string): { message: string } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(text.slice(start, end + 1));
    return typeof value === "object" &&
      value !== null &&
      "message" in value &&
      typeof value.message === "string"
      ? { ...value, message: value.message }
      : null;
  } catch {
    return null;
  }
}

export function isFinalReport(text: string): boolean {
  return (
    DONE_PREFIX.test(text) || DONE_PREFIX.test(narrativeOf(text)?.message ?? "")
  );
}

/** The report as the owner should read it, without the marker. */
export function reportText(text: string): string {
  const report = text.replace(DONE_PREFIX, "").trim();
  const narrative = narrativeOf(report);
  return narrative && DONE_PREFIX.test(narrative.message)
    ? JSON.stringify({
        ...narrative,
        message: narrative.message.replace(DONE_PREFIX, "").trim(),
      })
    : report;
}
