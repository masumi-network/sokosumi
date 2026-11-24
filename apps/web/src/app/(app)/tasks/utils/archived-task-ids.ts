/**
 * Tasks archived in this tab. The board stays mounted across the task page.
 * A missing first-page id is not an archive: each column is 20 rows ordered
 * by updatedAt, so a newer row pushes the last row off. Drop only ids here.
 */
const archivedTaskIds = new Set<string>();
const pendingArchiveTaskIds = new Set<string>();

export function markTaskArchived(taskId: string) {
  archivedTaskIds.add(taskId);
  pendingArchiveTaskIds.add(taskId);
}

/** The background archive succeeded: keep hiding stale rows, stop pinning cursors. */
export function settleTaskArchive(taskId: string) {
  pendingArchiveTaskIds.delete(taskId);
}

/** The archive failed: the board shows the task again. */
export function unmarkTaskArchived(taskId: string) {
  archivedTaskIds.delete(taskId);
  pendingArchiveTaskIds.delete(taskId);
}

export function isTaskArchived(taskId: string) {
  return archivedTaskIds.has(taskId);
}

export function isTaskArchivePending(taskId: string) {
  return pendingArchiveTaskIds.has(taskId);
}
