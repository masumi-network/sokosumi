import { type Prisma, TaskVisibility } from "@sokosumi/database";
import { notFound } from "@/helpers/error";
import { buildAccessibleCoworkersWhere } from "@/helpers/vendor-membership";
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
      OR: [
        { assigneeId: coworkerId },
        {
          visibility: TaskVisibility.PUBLIC,
          creatorCoworkerId: coworkerId,
        },
      ],
    };
  }

  const accessibleCoworkerWhere = buildAccessibleCoworkersWhere(userId);

  return {
    ...base,
    OR: [
      { assignee: accessibleCoworkerWhere },
      {
        visibility: TaskVisibility.PUBLIC,
        creatorCoworker: accessibleCoworkerWhere,
      },
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
