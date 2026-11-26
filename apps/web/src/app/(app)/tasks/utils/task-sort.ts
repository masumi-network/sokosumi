import type { TaskPriority } from "@sokosumi/core-client";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";

/** The orders Core's task list takes as `sort`, which Sort by offers. */
export const TASKS_SORT_VALUES = [
  "updatedAt",
  "createdAt",
  "priority",
  "dueOn",
] as const;

export type TasksSort = (typeof TASKS_SORT_VALUES)[number];

export function parseTasksSort(raw: unknown): TasksSort | undefined {
  return TASKS_SORT_VALUES.find((value) => value === raw);
}

/**
 * The order shown when the reader picked none: the board sorts its loaded
 * cards by last update, the list keeps Core's default, newest created first.
 */
export function effectiveTasksSort(
  sort: TasksSort | undefined,
  viewMode: "board" | "list",
): TasksSort {
  return sort ?? (viewMode === "board" ? "updatedAt" : "createdAt");
}

// Core orders the priority enum as declared: urgent first, none last.
const PRIORITY_RANK: Record<TaskPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

function byTimeDesc(a: string, b: string): number {
  return new Date(b).getTime() - new Date(a).getTime();
}

/**
 * Compares tasks in descending order (newest first). Uses string comparison for
 * updatedAt (ISO 8601) to avoid Date allocation in the hot sort path.
 */
export function compareTasksDesc(
  a: TaskWithCoworker,
  b: TaskWithCoworker,
): number {
  const updatedAtDiff = byTimeDesc(a.updatedAt, b.updatedAt);
  if (updatedAtDiff !== 0) return updatedAtDiff;
  return b.id.localeCompare(a.id);
}

/**
 * The client order for a Sort by choice, matching Core's `orderBy` for the
 * same `sort`, so a card that arrives live lands where a reload puts it.
 */
export function compareTasks(
  sort: TasksSort,
): (a: TaskWithCoworker, b: TaskWithCoworker) => number {
  switch (sort) {
    case "updatedAt":
      return compareTasksDesc;
    case "createdAt":
      return (a, b) =>
        byTimeDesc(a.createdAt, b.createdAt) || b.id.localeCompare(a.id);
    case "priority":
      return (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        compareTasksDesc(a, b);
    case "dueOn":
      // Earliest due first, Tasks without a due day last.
      return (a, b) => {
        if (a.dueOn && b.dueOn && a.dueOn !== b.dueOn) {
          return a.dueOn < b.dueOn ? -1 : 1;
        }
        if (!a.dueOn !== !b.dueOn) return a.dueOn ? -1 : 1;
        return a.id.localeCompare(b.id);
      };
  }
}
