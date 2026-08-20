import { TaskPaymentClaimStatus } from "@sokosumi/database";
import type { createPrismaClient } from "@sokosumi/database/client";

import { deleteTaskFileIfOwned } from "@/lib/blob";

type PrismaClient = ReturnType<typeof createPrismaClient>;

/**
 * Clear creator RESTRICT blockers before deleting a user.
 *
 * - Owned tasks are deleted (owner cascade would anyway).
 * - Tasks this user (or their assigned coworkers) created but do not own keep the
 *   row and re-point creator to the task owner as a user creator.
 * - Coworker assignments cascade-delete with the user; creatorCoworkerId is
 *   RESTRICT, so those refs must be cleared first.
 * - Payment-claim blockers live in `evaluateUserDeletion`. This prep runs only
 *   after that list is empty. Terminal claims are removed so their RESTRICT
 *   transaction relations do not block user cascade.
 * - Public blob files for owned tasks are best-effort deleted after the DB
 *   cascade (URLs remain public if blob GC fails).
 */
export async function prepareTasksForUserDeletion(
  userId: string,
  prisma: PrismaClient,
): Promise<void> {
  const ownedTaskFiles = await prisma.$transaction(async (tx) => {
    await tx.taskPaymentClaim.deleteMany({
      where: {
        status: {
          in: [
            TaskPaymentClaimStatus.PURCHASED,
            TaskPaymentClaimStatus.REFUNDED,
          ],
        },
        OR: [{ transaction: { userId } }, { refundTransaction: { userId } }],
      },
    });

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

    const ownedFiles = await tx.taskFile.findMany({
      where: { task: { ownerId: userId } },
      select: { fileUrl: true, taskId: true },
    });

    await tx.task.deleteMany({
      where: { ownerId: userId },
    });

    return ownedFiles;
  });

  await Promise.all(
    ownedTaskFiles.map((file) =>
      deleteTaskFileIfOwned(file.fileUrl, file.taskId),
    ),
  );
}
