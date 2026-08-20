import * as Sentry from "@sentry/node";
import {
  TaskPaymentClaimStatus,
  TaskX402PaymentStatus,
} from "@sokosumi/database";
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
 * - Payment-claim blockers live in `evaluateUserDeletion`. This prep runs only
 *   after that list is empty. Terminal claims are removed so their RESTRICT
 *   transaction relations do not block user cascade.
 * - Pending x402 payments block deletion the same way (the reconciler clears
 *   them within a bounded window, so no operator page) and are also reported
 *   by `evaluateUserDeletion`. Every non-PENDING x402 payment is removed
 *   because its RESTRICT task and transaction relations would otherwise
 *   block both the owned-task delete and the user cascade. A swept payment
 *   whose charge belongs to another user pages Sentry — it means Task.ownerId
 *   was not the billing owner.
 * - Chat rooms this user created re-point `createdByUserId` to another remaining
 *   human member. Rooms with no other human member are deleted so Restrict does
 *   not 500 an allowed wipe.
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

    // A PENDING x402 payment either re-runs its sign on coworker retry or is
    // auto-refunded by the reconciler — bounded, self-clearing, so unlike a
    // review-required claim it never pages Sentry. The task-owner branch
    // matters because taskId is RESTRICT: a pending payment on an owned task
    // blocks the owned-task delete below regardless of who was charged.
    const pendingX402Payment = await tx.taskX402Payment.findFirst({
      where: {
        status: TaskX402PaymentStatus.PENDING,
        // refundTransaction should be impossible on a PENDING row (the refund
        // is written when status flips), but nothing DB-level forbids it and
        // the FK is RESTRICT — without this branch such a row would fail the
        // user cascade with a raw FK 500 instead of this clean 400.
        OR: [
          { transaction: { userId } },
          { refundTransaction: { userId } },
          { task: { ownerId: userId } },
        ],
      },
      select: { id: true },
    });
    if (pendingX402Payment) {
      throw new APIError("BAD_REQUEST", {
        code: "TASK_X402_PAYMENT_PENDING",
        message:
          "Wait for pending task payments to settle before deleting your account.",
      });
    }

    // The sweep below deletes on `task.ownerId` regardless of who was
    // charged. Task.ownerId is documented as always the billing owner, so a
    // row swept through the task-owner (or refund) branch whose charge belongs
    // to someone else should be unreachable — but nothing enforces that. If it
    // ever happens, one user's account deletion silently destroys a different,
    // live user's payment record: the charge Transaction survives, while the
    // chain leg, nonce, agent and network are lost. Narrowing the sweep is not
    // the fix (the task-owner branch is load-bearing for the RESTRICT on
    // taskId), so make the invariant break visible instead.
    const foreignChargePayment = await tx.taskX402Payment.findFirst({
      where: {
        status: { not: TaskX402PaymentStatus.PENDING },
        transaction: { userId: { not: userId } },
        // Only the non-charge branches can reach a foreign charge; the
        // `transaction: { userId }` branch is this user's own by definition.
        OR: [{ refundTransaction: { userId } }, { task: { ownerId: userId } }],
      },
      select: {
        id: true,
        taskId: true,
        transaction: { select: { userId: true } },
      },
    });
    if (foreignChargePayment) {
      Sentry.captureMessage(
        "Account deletion is removing a task x402 payment charged to another user",
        {
          level: "error",
          tags: { error_type: "user_deletion_x402_payment_foreign_charge" },
          extra: {
            userId,
            taskX402PaymentId: foreignChargePayment.id,
            taskId: foreignChargePayment.taskId,
            chargedUserId: foreignChargePayment.transaction.userId,
          },
        },
      );
    }

    // Non-pending x402 payments hold RESTRICT relations on the task, the
    // charge transaction, and any refund transaction; every branch must be
    // swept or the owned-task delete / user cascade fails. Operator
    // attribution survives in the FK-free task_x402_payment_action rows.
    //
    // Negating PENDING rather than listing the terminal statuses is
    // deliberate: the guard above already rejects PENDING, so everything
    // reaching here must be swept, and this predicate stays exhaustive as
    // the enum grows. An enumeration would silently miss a new status (the
    // planned EXPIRED_UNUSED, say) — it would match neither branch, survive
    // the sweep, and then fail the RESTRICT taskId FK on the task delete
    // below with a raw 500 instead of a clean deletion.
    await tx.taskX402Payment.deleteMany({
      where: {
        status: { not: TaskX402PaymentStatus.PENDING },
        OR: [
          { transaction: { userId } },
          { refundTransaction: { userId } },
          { task: { ownerId: userId } },
        ],
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

    const createdRooms = await tx.chatRoom.findMany({
      where: { createdByUserId: userId },
      select: {
        id: true,
        userMembers: {
          where: { userId: { not: userId } },
          select: { userId: true },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });

    for (const room of createdRooms) {
      const nextCreatorId = room.userMembers[0]?.userId;
      if (nextCreatorId) {
        await tx.chatRoom.update({
          where: { id: room.id },
          data: { createdByUserId: nextCreatorId },
        });
        continue;
      }

      await tx.chatRoom.delete({
        where: { id: room.id },
      });
    }

    return ownedFiles;
  });

  await Promise.all(
    ownedTaskFiles.map((file) =>
      deleteTaskFileIfOwned(file.fileUrl, file.taskId),
    ),
  );
}
