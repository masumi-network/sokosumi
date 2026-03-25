import { type Prisma } from "@sokosumi/database";

import { badRequest, conflict } from "@/helpers/error";

/** At most one link row may exist between two tasks (any direction or link type). */
export async function assertTaskLinkAllowed(
  tx: Prisma.TransactionClient,
  fromTaskId: string,
  toTaskId: string,
): Promise<void> {
  if (fromTaskId === toTaskId) {
    throw badRequest("A task cannot link to itself");
  }

  const existing = await tx.taskLink.findFirst({
    where: {
      OR: [
        { fromTaskId, toTaskId },
        { fromTaskId: toTaskId, toTaskId: fromTaskId },
      ],
    },
  });

  if (existing) {
    throw conflict("A link already exists between these tasks");
  }
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  return (error as { code?: unknown }).code === "P2002";
}
