import * as Sentry from "@sentry/node";
import { TaskPaymentClaimStatus } from "@sokosumi/database";
import type { createPrismaClient } from "@sokosumi/database/client";
import { APIError } from "better-auth/api";

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
 * - Pending task-payment claims block deletion because their debit must remain
 *   available for purchase recovery or compensation. Terminal claims are
 *   removed so their RESTRICT transaction relations do not block user cascade.
 * - Public blob files for owned tasks are best-effort deleted after the DB
 *   cascade (URLs remain public if blob GC fails).
 */
export async function prepareTasksForUserDeletion(
  userId: string,
  prisma: PrismaClient,
): Promise<void> {
  const ownedTaskFiles = await prisma.$transaction(async (tx) => {
    const pendingPaymentClaim = await tx.taskPaymentClaim.findFirst({
      where: {
        status: TaskPaymentClaimStatus.PENDING,
        transaction: { userId },
      },
      select: { id: true, reviewRequiredAt: true },
    });
    if (pendingPaymentClaim) {
      if (pendingPaymentClaim.reviewRequiredAt) {
        // A plain PENDING claim clears itself within a cron cycle, but one
        // parked for review clears only when an operator resolves it — so
        // this branch is an account deletion blocked for an unbounded time by
        // an internal queue. Page it: the user cannot unblock themselves, and
        // the admin resolve/refund endpoints are the only way out.
        Sentry.captureMessage(
          "Account deletion blocked by a task payment claim awaiting review",
          {
            level: "error",
            tags: { error_type: "user_deletion_blocked_by_claim_review" },
            extra: {
              userId,
              taskPaymentClaimId: pendingPaymentClaim.id,
              reviewRequiredAt:
                pendingPaymentClaim.reviewRequiredAt.toISOString(),
            },
          },
        );
        throw new APIError("BAD_REQUEST", {
          code: "TASK_PAYMENT_CLAIM_REVIEW_REQUIRED",
          message:
            "A task payment needs administrator review before your account can be deleted. Please contact support.",
        });
      }
      throw new APIError("BAD_REQUEST", {
        code: "TASK_PAYMENT_CLAIM_PENDING",
        message:
          "Wait for pending task payments to settle before deleting your account.",
      });
    }

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
