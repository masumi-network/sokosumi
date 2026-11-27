import type { Prisma } from "@sokosumi/database";
import { netTable } from "@sokosumi/database/sql-tables";

import {
  applyRulesAfterDelete,
  type RuleCounts,
} from "@/helpers/user-deletion-crossing-rules";
import { networksThatAreOn } from "@/lib/network";

/**
 * The keys of `src/lib/db/crossing-keys.ts` owned by the Soko Bot deletion,
 * done by Core in every Network that is on, by the rule
 * of `user-deletion-crossing-rules.ts`: a refusal before the parent's delete,
 * a cascade after it and only where the parent is gone.
 */
type Tx = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;

/**
 * What the Soko Bot deletion counts in the Networks: usage rows
 * (`soko_bot_usage.sokoBotId` cascades) and hired Jobs
 * (`Job.creatorSokoBotId` restricts). Either keeps the tombstone.
 */
export async function countSokoBotNetworkRows(
  tx: Tx,
  sokoBotId: string,
): Promise<{ billingRecords: number; jobs: number }> {
  let billingRecords = 0;
  let jobs = 0;
  for (const network of networksThatAreOn()) {
    const [counts] = await tx.$queryRaw<{ usage: number; jobs: number }[]>`
      SELECT
        (SELECT count(*)::int FROM ${netTable(network, "soko_bot_usage")}
          WHERE "sokoBotId" = ${sokoBotId}::uuid) AS usage,
        (SELECT count(*)::int FROM ${netTable(network, "Job")}
          WHERE "creatorSokoBotId" = ${sokoBotId}::uuid) AS jobs
    `;
    billingRecords += counts.usage;
    jobs += counts.jobs;
  }
  return { billingRecords, jobs };
}

/** After the Soko Bot row is deleted: its usage rows, while no bot with its id exists. */
export function applySokoBotRules(
  tx: Tx,
  sokoBotId: string,
): Promise<RuleCounts> {
  return applyRulesAfterDelete(tx, {
    taskIds: [],
    taskEventIds: [],
    projectIds: [],
    sokoBotIds: [sokoBotId],
  });
}
