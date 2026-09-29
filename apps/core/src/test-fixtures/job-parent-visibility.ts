import type { TaskVisibility } from "@sokosumi/database";

export interface StoredParentTask {
  visibility: TaskVisibility;
  ownerId: string;
}

interface JobParentVisibilityWhere {
  OR: Array<{
    taskId?: null;
    task?: { is: { OR: Partial<StoredParentTask>[] } };
  }>;
}

/**
 * Applies a route's `buildHumanJobParentVisibilityWhere` OR clauses to one
 * stored Job, so mocked-Prisma tests exercise the real human visibility rule
 * instead of a hand-picked null. `parentTask: null` is a Job with no Task.
 */
export function matchesJobParentVisibility(
  parentTask: StoredParentTask | null,
  where: JobParentVisibilityWhere,
): boolean {
  return where.OR.some((clause) => {
    if (!clause.task) {
      return parentTask === null;
    }
    return (
      parentTask !== null &&
      clause.task.is.OR.some((taskClause) =>
        Object.entries(taskClause).every(
          ([key, value]) => parentTask[key as keyof StoredParentTask] === value,
        ),
      )
    );
  });
}
