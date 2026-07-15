import type { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

export interface TaskListStatusFilterParams {
  statuses?: TaskStatus[];
  pendingApproval?: boolean;
  includeParkedReady?: boolean;
}

export function buildTaskListStatusWhere(
  params: TaskListStatusFilterParams,
): Prisma.TaskWhereInput {
  const { statuses, pendingApproval, includeParkedReady } = params;

  if (
    !statuses?.length &&
    pendingApproval === undefined &&
    !includeParkedReady
  ) {
    return {};
  }

  const pendingFilter: Prisma.TaskWhereInput =
    pendingApproval === true
      ? { pendingVendorGrantId: { not: null } }
      : pendingApproval === false
        ? { pendingVendorGrantId: null }
        : {};

  if (includeParkedReady && statuses?.length) {
    const parkedReadyFilter: Prisma.TaskWhereInput = {
      status: TaskStatus.READY,
      pendingVendorGrantId: { not: null },
    };

    return {
      AND: [
        {
          OR: [{ status: { in: statuses } }, parkedReadyFilter],
        },
        ...(Object.keys(pendingFilter).length > 0 ? [pendingFilter] : []),
      ],
    };
  }

  return {
    ...(statuses?.length ? { status: { in: statuses } } : {}),
    ...pendingFilter,
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
