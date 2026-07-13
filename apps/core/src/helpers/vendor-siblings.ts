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

type TaskForSiblingCheck = Prisma.TaskGetPayload<{
  select: typeof taskSiblingSelect;
}>;

export async function loadTaskForSiblingCheck(
  taskId: string,
  workspaceId: string | null,
  tx: Prisma.TransactionClient = prisma,
): Promise<TaskForSiblingCheck | null> {
  return await tx.task.findFirst({
    where: {
      id: taskId,
      ...(workspaceId ? { workspaceId } : {}),
      archivedAt: null,
    },
    select: taskSiblingSelect,
  });
}

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
    OR: [
      { coworkerId: params.coworkerId },
      {
        status: { not: TaskStatus.DRAFT },
        coworkerId: { not: params.coworkerId },
        coworker: {
          vendorId: params.vendorId,
        },
      },
    ],
  };
}
