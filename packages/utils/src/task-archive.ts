/**
 * Task statuses that allow archive (soft-delete). Values match the Prisma
 * `TaskStatus` enum in `@sokosumi/database`.
 *
 * Implemented as string literals so this package does not depend on
 * `@sokosumi/database` at runtime (that package already depends on utils).
 */
export const TASK_ARCHIVABLE_STATUSES = [
  "DRAFT",
  "QUEUED",
  "READY",
  "CANCELED",
  "COMPLETED",
  "FAILED",
] as const;

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

/**
 * Parked vendor-grant tasks use `APPROVAL_REQUIRED` plus `pendingVendorGrantId`.
 * Owners and org OWNER/ADMIN may soft-archive them while waiting for approval.
 */
export function isParkedVendorGrantTask(
  status: string,
  pendingVendorGrantId?: string | null,
): boolean {
  return status === "APPROVAL_REQUIRED" && pendingVendorGrantId != null;
}

export function canArchiveTaskStatus(
  status: string,
  pendingVendorGrantId?: string | null,
): boolean {
  return (
    isTaskArchivableStatus(status) ||
    isParkedVendorGrantTask(status, pendingVendorGrantId)
  );
}

export function getTaskCannotArchiveMessage(currentStatus: string): string {
  const allowed = TASK_ARCHIVABLE_STATUSES.join(", ");
  return `Tasks can only be archived when the status is one of: ${allowed}. Current status: ${currentStatus}.`;
}
