/**
 * Tasks archived in this tab. The board stays mounted across the task page.
 * A missing first-page id is not an archive: each column is 20 rows ordered
 * by updatedAt, so a newer row pushes the last row off. Drop only ids here.
 */
let archivedTaskIds: ReadonlySet<string> = new Set();
const pendingArchiveTaskIds = new Set<string>();
const archivedTaskIdsListeners = new Set<() => void>();

function notifyArchivedTaskIds() {
  for (const listener of archivedTaskIdsListeners) {
    listener();
  }
}

export function markTaskArchived(taskId: string) {
  pendingArchiveTaskIds.add(taskId);
  if (archivedTaskIds.has(taskId)) return;
  const next = new Set(archivedTaskIds);
  next.add(taskId);
  archivedTaskIds = next;
  notifyArchivedTaskIds();
}

/** The background archive succeeded: keep hiding stale rows, stop pinning cursors. */
export function settleTaskArchive(taskId: string) {
  pendingArchiveTaskIds.delete(taskId);
}

/** The archive failed: the board shows the task again. */
export function unmarkTaskArchived(taskId: string) {
  pendingArchiveTaskIds.delete(taskId);
  if (!archivedTaskIds.has(taskId)) return;
  const next = new Set(archivedTaskIds);
  next.delete(taskId);
  archivedTaskIds = next;
  notifyArchivedTaskIds();
}

export function subscribeArchivedTaskIds(listener: () => void) {
  archivedTaskIdsListeners.add(listener);
  return () => {
    archivedTaskIdsListeners.delete(listener);
  };
}

export function getArchivedTaskIds(): ReadonlySet<string> {
  return archivedTaskIds;
}

export function isTaskArchived(taskId: string) {
  return archivedTaskIds.has(taskId);
}

export function isTaskArchivePending(taskId: string) {
  return pendingArchiveTaskIds.has(taskId);
}
