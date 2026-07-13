import { type Prisma } from "@sokosumi/database";
import { TaskStatus } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import type { CoworkerAuthenticationContext } from "@/middleware/auth";

import { notFound } from "./error";

const taskSiblingSelect = {
  coworkerId: true,
  status: true,
  coworker: {
    select: {
      vendorId: true,
    },
  },
} as const;

export type TaskForSiblingCheck = Prisma.TaskGetPayload<{
  select: typeof taskSiblingSelect;
}>;

export function isSameVendorSiblingTask(
  actor: CoworkerAuthenticationContext,
  task: TaskForSiblingCheck,
): boolean {
  if (task.status === TaskStatus.DRAFT) {
    return false;
  }

  if (!task.coworkerId || !task.coworker?.vendorId) {
    return false;
  }

  if (task.coworkerId === actor.coworkerId) {
    return false;
  }

  return task.coworker.vendorId === actor.vendorId;
}

export async function loadActorVendorId(
  coworkerId: string,
  tx: Prisma.TransactionClient = prisma,
): Promise<string> {
  const coworker = await tx.coworker.findUnique({
    where: { id: coworkerId },
    select: { vendorId: true },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }

  return coworker.vendorId;
}

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
