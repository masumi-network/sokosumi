import { USER_TRANSITION_TASK_STATUSES } from "./task-status-transitions.js";

/**
 * Task statuses that allow archive (soft-delete). Values match the Prisma
 * `TaskStatus` enum in `@sokosumi/database`.
 *
 * Implemented as string literals so this package does not depend on
 * `@sokosumi/database` at runtime (that package already depends on utils).
 */
// CANCELED stays before COMPLETED and FAILED so the archive error string
// keeps its current order.
const archivableStatuses = [
  "DRAFT",
  "QUEUED",
  "READY",
  "GRANT_PENDING",
  "CANCELED",
  "COMPLETED",
  "FAILED",
] as const satisfies readonly (typeof USER_TRANSITION_TASK_STATUSES)[number][];

export const TASK_ARCHIVABLE_STATUSES = archivableStatuses.filter((status) =>
  USER_TRANSITION_TASK_STATUSES.includes(status),
);

export type TaskArchivableStatus = (typeof TASK_ARCHIVABLE_STATUSES)[number];

/**
 * Tasks may be archived only when the coworker has not started work or has
 * finished (terminal outcome or still editable pre-run states).
 */
export function isTaskArchivableStatus(
  status: string,
): status is TaskArchivableStatus {
  return (TASK_ARCHIVABLE_STATUSES as readonly string[]).includes(status);
}

export function canArchiveTaskStatus(status: string): boolean {
  return isTaskArchivableStatus(status);
}

export function getTaskCannotArchiveMessage(currentStatus: string): string {
  const allowed = TASK_ARCHIVABLE_STATUSES.join(", ");
  return `Tasks can only be archived when the status is one of: ${allowed}. Current status: ${currentStatus}.`;
}
