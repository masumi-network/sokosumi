/**
 * Notification kinds for in-app notifications.
 *
 * Client-safe single source of truth, re-used by `@sokosumi/database`,
 * `apps/core`, and `apps/web`. Moved here as a const map (per the repo
 * convention to avoid enums) so consumers can reference these values without
 * pulling in `@sokosumi/database`.
 */
export const NotificationKind = {
  JOB: "JOB",
  TASK: "TASK",
  CONVERSATION: "CONVERSATION",
  BILLING: "BILLING",
  SYSTEM: "SYSTEM",
  COWORKER_ACCESS: "COWORKER_ACCESS",
} as const;

export type NotificationKind =
  (typeof NotificationKind)[keyof typeof NotificationKind];
