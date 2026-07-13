import { type Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

interface CoworkerAuthorizedTaskWhereParams {
  taskId: string;
  coworkerId: string;
  vendorId: string;
  workspaceId?: string | null;
}

/**
 * Single-task coworker read/list filter: assignee or same-vendor sibling, non-DRAFT.
 */
export function buildCoworkerAuthorizedTaskWhere(
  params: CoworkerAuthorizedTaskWhereParams,
): Prisma.TaskWhereInput {
  return {
    id: params.taskId,
    archivedAt: null,
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...buildCoworkerSiblingTaskListFilter({
      coworkerId: params.coworkerId,
      vendorId: params.vendorId,
    }),
  };
}

interface CoworkerSiblingTaskListAccessParams {
  coworkerId: string;
  vendorId: string;
}

/**
 * Coworker task lists: assignee tasks plus same-vendor siblings (non-DRAFT).
 */
export function buildCoworkerSiblingTaskListFilter(
  params: CoworkerSiblingTaskListAccessParams,
): Prisma.TaskWhereInput {
  return {
    status: { not: TaskStatus.DRAFT },
    OR: [
      { coworkerId: params.coworkerId },
      {
        coworkerId: { not: params.coworkerId },
        coworker: {
          vendorId: params.vendorId,
        },
      },
    ],
  };
}
