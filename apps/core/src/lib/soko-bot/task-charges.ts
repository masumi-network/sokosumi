import { convertCentsToCredits } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

/**
 * Credits actually charged on each Task, from the debits its events carry
 * (the same sum the Task page shows). A bot compares this with what the owner
 * approved; nothing on the platform stops a Coworker at a stated cap.
 */
export async function taskCreditsCharged(
  taskIds: readonly string[],
): Promise<Map<string, number>> {
  const charged = new Map<string, number>();
  if (taskIds.length === 0) return charged;
  const events = await prisma.taskEvent.findMany({
    where: { taskId: { in: [...taskIds] }, transaction: { amount: { lt: 0 } } },
    select: { taskId: true, transaction: { select: { amount: true } } },
  });
  for (const event of events) {
    const amount = event.transaction?.amount;
    if (amount == null) continue;
    charged.set(
      event.taskId,
      (charged.get(event.taskId) ?? 0) + convertCentsToCredits(-amount),
    );
  }
  return charged;
}

/** Two decimals: what a person reads, not a float's tail. */
export function roundCredits(credits: number): number {
  return Math.round(credits * 100) / 100;
}
