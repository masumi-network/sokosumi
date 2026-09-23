import type { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

export interface TaskListStatusFilterParams {
  statuses?: TaskStatus[];
}

export interface TaskListScheduleFilterParams {
  hasSchedule?: boolean;
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

export function buildTaskListScheduleWhere(
  params: TaskListScheduleFilterParams,
): Prisma.TaskWhereInput {
  const { hasSchedule } = params;

  if (hasSchedule === undefined) {
    return {};
  }

  if (hasSchedule) {
    return {
      OR: [{ metadata: { not: null } }, { nextRunAt: { not: null } }],
    };
  }

  return {
    AND: [{ metadata: null }, { nextRunAt: null }],
  };
}

function normalizeAnd(
  and: Prisma.TaskWhereInput | Prisma.TaskWhereInput[] | undefined,
): Prisma.TaskWhereInput[] {
  if (!and) {
    return [];
  }

  return Array.isArray(and) ? and : [and];
}

function mergeTaskListWhere(
  where: Prisma.TaskWhereInput,
  extraWhere: Prisma.TaskWhereInput,
): Prisma.TaskWhereInput {
  if (Object.keys(extraWhere).length === 0) {
    return where;
  }

  const existingAnd = normalizeAnd(where.AND);
  const extraAnd = normalizeAnd(extraWhere.AND);
  const { AND: _extraAnd, ...extraRest } = extraWhere;
  const mergedAnd = [...existingAnd, ...extraAnd];

  return {
    ...where,
    ...extraRest,
    ...(mergedAnd.length > 0 ? { AND: mergedAnd } : {}),
  };
}

export function applyTaskListStatusWhere(
  where: Prisma.TaskWhereInput,
  statusWhere: Prisma.TaskWhereInput,
): Prisma.TaskWhereInput {
  return mergeTaskListWhere(where, statusWhere);
}

export function applyTaskListScheduleWhere(
  where: Prisma.TaskWhereInput,
  hasSchedule: boolean | undefined,
): Prisma.TaskWhereInput {
  return mergeTaskListWhere(where, buildTaskListScheduleWhere({ hasSchedule }));
}
