import { sharedTable } from "@sokosumi/database/sql-tables";
import { convertCentsToCredits } from "@sokosumi/utils";

import { createNetworkScope } from "@/lib/db/network-scope";

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
  const scope = createNetworkScope("mainnet");
  const events = await scope.networkDb.$queryRaw<
    { taskId: string; amount: bigint }[]
  >`
    SELECT event."taskId", debit.amount
    FROM ${sharedTable("taskEvent")} event
    JOIN ${scope.networkTable("Transaction")} debit ON debit.id = event."transactionId"
    WHERE event."taskId" = ANY(${[...taskIds]}::text[])
      AND (event.network IS NULL OR event.network = 'mainnet')
      AND debit.amount < 0
  `;
  for (const { taskId, amount } of events) {
    charged.set(
      taskId,
      (charged.get(taskId) ?? 0) + convertCentsToCredits(-amount),
    );
  }
  return charged;
}

/** Two decimals: what a person reads, not a float's tail. */
export function roundCredits(credits: number): number {
  return Math.round(credits * 100) / 100;
}
