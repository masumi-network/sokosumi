import type { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

export interface TaskListStatusFilterParams {
  statuses?: TaskStatus[];
}

export function buildTaskListStatusWhere(
  params: TaskListStatusFilterParams,
): Prisma.TaskWhereInput {
  const { statuses } = params;

  if (!statuses?.length) {
    return {};
  }

  return { status: { in: statuses } };
}

function normalizeAnd(
  and: Prisma.TaskWhereInput | Prisma.TaskWhereInput[] | undefined,
): Prisma.TaskWhereInput[] {
  if (!and) {
    return [];
  }

  return Array.isArray(and) ? and : [and];
}

export function applyTaskListStatusWhere(
  where: Prisma.TaskWhereInput,
  statusWhere: Prisma.TaskWhereInput,
): Prisma.TaskWhereInput {
  if (Object.keys(statusWhere).length === 0) {
    return where;
  }

  const existingAnd = normalizeAnd(where.AND);
  const statusAnd = normalizeAnd(statusWhere.AND);
  const { AND: _statusAnd, ...statusRest } = statusWhere;
  const mergedAnd = [...existingAnd, ...statusAnd];

  return {
    ...where,
    ...statusRest,
    ...(mergedAnd.length > 0 ? { AND: mergedAnd } : {}),
  };
}
