import type { Prisma } from "@sokosumi/database";
import { netTable } from "@sokosumi/database/sql-tables";
import { createError } from "evlog";

import {
  applyRulesAfterDelete,
  type DeletionCandidates,
  findJobHiredByBots,
  type RuleCounts,
  workspaceBotIds,
} from "@/helpers/user-deletion-crossing-rules";
import { networksThatAreOn } from "@/lib/network";

/**
 * The keys of `src/lib/db/crossing-keys.ts` owned by the Soko Bot deletion and
 * the failed CMO hire, done by Core in every Network that is on, by the rule
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

/**
 * Before a Project is deleted with its Soko Bots: refuses where
 * `Job.creatorSokoBotId` would, and returns what `applyRulesAfterDelete`
 * needs afterwards.
 */
export async function checkProjectDeletion(
  tx: Tx,
  projectId: string,
): Promise<DeletionCandidates> {
  const sokoBotIds = await workspaceBotIds(tx, [projectId], []);
  for (const network of networksThatAreOn()) {
    const job = await findJobHiredByBots(tx, network, sokoBotIds);
    if (job) {
      // Follow-up (ticket 26, decision D5): the key refused this delete with
      // its raw error; the refusal stays, readable.
      throw createError({
        message: `PROJECT_DELETION_SOKO_BOT_HIRED_JOB: a Job hired by the Project's Soko Bot blocks deleting Project ${projectId}`,
        why: `Job ${job.id} on ${network} names the Soko Bot as its creator`,
        fix: "Keep the Project, or remove the Job's creator link by hand first",
      });
    }
  }
  return { taskIds: [], taskEventIds: [], projectIds: [projectId], sokoBotIds };
}

/**
 * Deletes a Project, which takes its Soko Bots with it, and the Network rows
 * that pointed at either. Throws, deleting nothing, where a key would refuse.
 */
export async function deleteProjectWithNetworkRows(
  tx: Tx & Pick<Prisma.TransactionClient, "project">,
  projectId: string,
): Promise<RuleCounts> {
  const candidates = await checkProjectDeletion(tx, projectId);
  await tx.project.delete({ where: { id: projectId } });
  return applyRulesAfterDelete(tx, candidates);
}
