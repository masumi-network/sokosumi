import type { createPrismaClient } from "@sokosumi/database/client";

type PrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Clear creator RESTRICT blockers before deleting a user.
 *
 * - Owned tasks are deleted (owner cascade would anyway).
 * - Tasks this user (or their assigned coworkers) created but do not own keep the
 *   row and re-point creator to the task owner as a user creator.
 * - Coworker assignments cascade-delete with the user; creatorCoworkerId is
 *   RESTRICT, so those refs must be cleared first.
 */
export async function prepareTasksForUserDeletion(
  userId: string,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const coworkerIds = (
      await tx.coworkerAssignment.findMany({
        where: { userId },
        select: { coworkerId: true },
      })
    ).map((assignment) => assignment.coworkerId);

    const createdTasks = await tx.task.findMany({
      where: {
        OR: [
          { creatorUserId: userId },
          ...(coworkerIds.length > 0
            ? [{ creatorCoworkerId: { in: coworkerIds } }]
            : []),
        ],
      },
      select: { id: true, ownerId: true },
    });

    for (const task of createdTasks) {
      if (task.ownerId === userId) continue;

      await tx.task.update({
        where: { id: task.id },
        data: {
          creatorUserId: task.ownerId,
          creatorCoworkerId: null,
          creatorOrchestratorId: null,
        },
      });
    }

    await tx.task.deleteMany({
      where: { ownerId: userId },
    });
  });
}
