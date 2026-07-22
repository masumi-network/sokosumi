import type { Prisma } from "@sokosumi/database";

import { notFound } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

export function buildDeveloperOwnedCoworkerTaskWhere(
  userId: string,
  coworkerId?: string,
): Prisma.TaskWhereInput {
  const base: Prisma.TaskWhereInput = {
    archivedAt: null,
  };

  if (coworkerId) {
    return {
      ...base,
      OR: [{ assigneeId: coworkerId }, { creatorCoworkerId: coworkerId }],
    };
  }

  return {
    ...base,
    OR: [{ assignee: { userId } }, { creatorCoworker: { userId } }],
  };
}

export async function requireOwnedCoworkerForFilter(
  userId: string,
  coworkerId: string,
): Promise<void> {
  const coworker = await prisma.coworker.findFirst({
    where: {
      id: coworkerId,
      userId,
    },
    select: { id: true },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }
}
