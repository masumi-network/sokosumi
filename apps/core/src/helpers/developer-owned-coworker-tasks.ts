import type { Prisma } from "@sokosumi/database";
import { notFound } from "@/helpers/error";
import { buildAccessibleCoworkersWhere } from "@/helpers/vendor-membership";
import prisma from "@/lib/db/prisma";

function buildAccessibleCoworkerRelationWhere(
  userId: string,
): Prisma.CoworkerWhereInput {
  return buildAccessibleCoworkersWhere(userId);
}

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

  const accessibleCoworkerWhere = buildAccessibleCoworkerRelationWhere(userId);

  return {
    ...base,
    OR: [
      { assignee: accessibleCoworkerWhere },
      { creatorCoworker: accessibleCoworkerWhere },
    ],
  };
}

export async function requireOwnedCoworkerForFilter(
  userId: string,
  coworkerId: string,
): Promise<void> {
  const coworker = await prisma.coworker.findFirst({
    where: {
      id: coworkerId,
      archivedAt: null,
      ...buildAccessibleCoworkersWhere(userId),
    },
    select: { id: true },
  });

  if (!coworker) {
    throw notFound("Coworker not found");
  }
}
