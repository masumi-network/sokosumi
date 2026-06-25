import type { TaskWithCoworker } from "@/lib/types/task";

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

/**
 * Scheduled column: soonest nextRunAt first. Tasks without nextRunAt sort last.
 */
export function compareScheduledTasksAsc(
  a: TaskWithCoworker,
  b: TaskWithCoworker,
): number {
  const aNextRunAt = a.nextRunAt ? new Date(a.nextRunAt).getTime() : null;
  const bNextRunAt = b.nextRunAt ? new Date(b.nextRunAt).getTime() : null;

  if (aNextRunAt == null && bNextRunAt == null) {
    return compareTasksDesc(a, b);
  }
  if (aNextRunAt == null) return 1;
  if (bNextRunAt == null) return -1;

  const nextRunDiff = aNextRunAt - bNextRunAt;
  if (nextRunDiff !== 0) return nextRunDiff;
  return a.id.localeCompare(b.id);
}
