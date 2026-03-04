import type { TaskWithCoworker } from "@/lib/types/task";

export function compareTasksDesc(
  a: TaskWithCoworker,
  b: TaskWithCoworker,
): number {
  const updatedAtDiff =
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  if (updatedAtDiff !== 0) return updatedAtDiff;
  return b.id.localeCompare(a.id);
}
