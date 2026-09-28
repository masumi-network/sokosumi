/**
 * Tasks archived in this tab. The board survives navigation to a task and
 * back, and a load-more row is never on the refreshed first page, so this is
 * the only way it learns such a row is gone.
 */
const archivedTaskIds = new Set<string>();

export function markTaskArchived(taskId: string) {
  archivedTaskIds.add(taskId);
}

export function isTaskArchived(taskId: string) {
  return archivedTaskIds.has(taskId);
}
