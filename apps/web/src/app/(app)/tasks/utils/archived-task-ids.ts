/**
 * Tasks archived in this tab. The board stays mounted across the task page.
 * A missing first-page id is not an archive: each column is 20 rows ordered
 * by updatedAt, so a newer row pushes the last row off. Drop only ids here.
 */
const archivedTaskIds = new Set<string>();
const listeners = new Set<() => void>();
let archivedVersion = 0;

function notify() {
  archivedVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function markTaskArchived(taskId: string) {
  if (archivedTaskIds.has(taskId)) return;
  archivedTaskIds.add(taskId);
  notify();
}

/** The archive failed: the board shows the task again. */
export function unmarkTaskArchived(taskId: string) {
  if (!archivedTaskIds.delete(taskId)) return;
  notify();
}

export function isTaskArchived(taskId: string) {
  return archivedTaskIds.has(taskId);
}

export function subscribeArchivedTaskIds(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getArchivedTaskIdsVersion() {
  return archivedVersion;
}

export function getServerArchivedTaskIdsVersion() {
  return 0;
}
