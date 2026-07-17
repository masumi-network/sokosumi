import { type Prisma, TaskStatus } from "@sokosumi/database";

interface CoworkerAuthorizedTaskWhereParams {
  taskId: string;
  coworkerId: string;
  vendorId: string;
  workspaceId?: string | null;
}

/**
 * Single-task coworker read/list filter: assignee or same-vendor sibling, non-DRAFT.
 *
 * When `workspaceId` is omitted (bare coworker, no `X-Context-*` headers), the filter
 * is vendor-wide: any non-DRAFT sibling task for that vendor may match.
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
      { assigneeId: params.coworkerId },
      {
        assigneeId: { not: params.coworkerId },
        assignee: {
          vendorId: params.vendorId,
        },
      },
    ],
  };
}
