import type { TaskWithCoworker } from "@/lib/types/task";

/**
 * Compares tasks in descending order (newest first). Uses string comparison for
 * updatedAt (ISO 8601) to avoid Date allocation in the hot sort path.
 */
export function compareTasksDesc(
  a: TaskWithCoworker,
  b: TaskWithCoworker,
): number {
  const updatedAtCmp = b.updatedAt.localeCompare(a.updatedAt);
  if (updatedAtCmp !== 0) return updatedAtCmp;
  return b.id.localeCompare(a.id);
}
