import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

/**
 * Compares tasks in descending order (newest first). Uses string comparison for
 * updatedAt (ISO 8601) to avoid Date allocation in the hot sort path.
 */
export function compareTasksDesc(
  a: TaskWithCoworker,
  b: TaskWithCoworker,
): number {
  const updatedAtDiff =
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (updatedAtDiff !== 0) return updatedAtDiff;
  return b.id.localeCompare(a.id);
}
