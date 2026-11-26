/** Task statuses worth waking the bot for; intermediate churn stays silent. */
export const TASK_WAKE_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "INPUT_REQUIRED",
  "APPROVAL_REQUIRED",
  "AUTHENTICATION_REQUIRED",
  "OUT_OF_CREDITS",
  "GRANT_PENDING",
]);

/** A hired Agent's Job statuses worth waking the bot for. */
export const JOB_WAKE_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "FAILED",
  "AWAITING_INPUT",
]);
