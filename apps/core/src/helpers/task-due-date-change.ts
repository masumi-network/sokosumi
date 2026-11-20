import type { Prisma } from "@sokosumi/database";

/**
 * Record a due date that moved to a later day, for the Task interest
 * delivery. Call it inside the transaction that wrote `dueOn`. Writes
 * nothing when the date moved earlier, was set for the first time, or was
 * cleared: none of those is the "due date moved later" moment.
 */
export async function recordTaskDueDateMovedLater(
  tx: Pick<Prisma.TransactionClient, "taskDueDateChange">,
  change: {
    taskId: string;
    from: Date | null;
    to: Date | null;
    actorUserId: string | null;
  },
): Promise<void> {
  if (!change.from || !change.to || change.to <= change.from) {
    return;
  }
  await tx.taskDueDateChange.create({
    data: {
      taskId: change.taskId,
      fromDueOn: change.from,
      toDueOn: change.to,
      actorUserId: change.actorUserId,
    },
  });
}
