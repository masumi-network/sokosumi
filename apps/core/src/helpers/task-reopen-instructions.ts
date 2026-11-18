import { type Prisma, TaskStatus } from "@sokosumi/database";

/**
 * True when a Task came back from COMPLETED or CANCELED and no person has
 * commented since. A Coworker or Soko Bot assigned now would start with no
 * instructions, so the caller parks the Task in INPUT_REQUIRED instead.
 */
export async function taskReopenedWithoutInstructions(
  tx: Prisma.TransactionClient,
  taskId: string,
): Promise<boolean> {
  const finished = await tx.taskEvent.findFirst({
    where: {
      taskId,
      status: { in: [TaskStatus.COMPLETED, TaskStatus.CANCELED] },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true },
  });
  if (!finished) return false;
  const instructions = await tx.taskEvent.count({
    where: {
      taskId,
      createdAt: { gt: finished.createdAt },
      userId: { not: null },
      comment: { not: null },
      NOT: { comment: "" },
    },
  });
  return instructions === 0;
}

export function reopenedWithoutInstructionsComment(assigneeName: string) {
  return `Reopened without instructions. Tell ${assigneeName} what to do.`;
}
