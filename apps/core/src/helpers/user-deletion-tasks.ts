import type { createPrismaClient } from "@sokosumi/database/client";

type PrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Clear task creatorUserId RESTRICT blockers before deleting a user.
 * Owned tasks are deleted (owner cascade would anyway). Tasks this user
 * created but does not own keep the row and re-point creator to the owner.
 */
export async function prepareTasksForUserDeletion(
  userId: string,
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const createdTasks = await tx.task.findMany({
      where: { creatorUserId: userId },
      select: { id: true, ownerId: true },
    });

    for (const task of createdTasks) {
      if (task.ownerId === userId) continue;

      await tx.task.update({
        where: { id: task.id },
        data: { creatorUserId: task.ownerId },
      });
    }

    await tx.task.deleteMany({
      where: { ownerId: userId },
    });
  });
}
