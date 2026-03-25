import { type Prisma, TaskLinkType } from "@sokosumi/database";

import { badRequest, conflict } from "@/helpers/error";

async function assertNoMirroredEdge(
  tx: Prisma.TransactionClient,
  fromTaskId: string,
  toTaskId: string,
  type: TaskLinkType,
  message: string,
): Promise<void> {
  const mirrored = await tx.taskLink.findFirst({
    where: {
      fromTaskId: toTaskId,
      toTaskId: fromTaskId,
      type,
    },
  });
  if (mirrored) {
    throw conflict(message);
  }
}

export async function assertTaskLinkAllowed(
  tx: Prisma.TransactionClient,
  fromTaskId: string,
  toTaskId: string,
  type: TaskLinkType,
): Promise<void> {
  if (fromTaskId === toTaskId) {
    throw badRequest("A task cannot link to itself");
  }

  if (type === TaskLinkType.RELATES) {
    await assertNoMirroredEdge(
      tx,
      fromTaskId,
      toTaskId,
      type,
      "A related link already exists for this task pair",
    );
  }

  if (type === TaskLinkType.PARENT) {
    await assertNoMirroredEdge(
      tx,
      fromTaskId,
      toTaskId,
      type,
      "A parent/child link already exists in the opposite direction",
    );
  }
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { code?: unknown }).code === "P2002";
}
