import type { Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/database";

export interface TaskListStatusFilterParams {
  statuses?: TaskStatus[];
}

export function buildTaskListStatusWhere(
  params: TaskListStatusFilterParams,
): Pick<Prisma.TaskWhereInput, "status"> {
  const { statuses } = params;

  if (!statuses?.length) {
    return {};
  }

  return { status: { in: statuses } };
}

export function applyTaskListStatusWhere(
  where: Prisma.TaskWhereInput,
  { status }: Pick<Prisma.TaskWhereInput, "status">,
): Prisma.TaskWhereInput {
  return status === undefined ? where : { ...where, status };
}
