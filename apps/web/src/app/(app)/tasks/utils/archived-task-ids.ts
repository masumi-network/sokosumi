/**
 * Tasks archived in this tab. The board stays mounted across the task page.
 * A missing first-page id is not an archive: each column is 20 rows ordered
 * by updatedAt, so a newer row pushes the last row off. Drop only ids here.
 */
const archivedTaskIds = new Set<string>();

export function markTaskArchived(taskId: string) {
  archivedTaskIds.add(taskId);
}

export function isTaskArchived(taskId: string) {
  return archivedTaskIds.has(taskId);
}
