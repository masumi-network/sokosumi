import type { Prisma } from "@sokosumi/database";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { createError } from "evlog";

import {
  applyRulesAfterDelete,
  type DeletionCandidates,
  type RuleCounts,
  workspaceBotIds,
} from "@/helpers/user-deletion-crossing-rules";
import type prisma from "@/lib/db/prisma";
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
  for (const network of networksThatAreOn()) {
    // One statement, so the Job and its creator's Project are one snapshot:
    // a bot that moved to another Project and hired there does not refuse.
    const [job] = await tx.$queryRaw<{ id: string }[]>`
      SELECT job."id" FROM ${netTable(network, "Job")} AS job
      JOIN ${sharedTable("soko_bot")} AS bot ON bot."id" = job."creatorSokoBotId"
      WHERE bot."projectId" = ${projectId}::uuid
      LIMIT 1
    `;
    if (job) {
      // Follow-up (ticket 26, decision D5): the key refused this delete with
      // its raw error; the refusal stays, readable.
      throw createError({
        code: "PROJECT_DELETION_SOKO_BOT_HIRED_JOB",
        message: `A Job hired by the Project's Soko Bot blocks deleting Project ${projectId}`,
        why: `Job ${job.id} on ${network} names the Soko Bot as its creator`,
        fix: "Keep the Project, or remove the Job's creator link by hand first",
      });
    }
  }
  // For the guarded usage sweep only: a bot that left keeps its rows there.
  const sokoBotIds = await workspaceBotIds(tx, [projectId], []);
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

/** Attempts of `deleteProjectInTransaction`, each with Prisma's 5 s budget. */
export const PROJECT_DELETION_ATTEMPTS = 4;

/**
 * `deleteProjectWithNetworkRows` in its own transaction. The single delete it
 * replaced waited on a row lock as long as another writer held it; a
 * transaction expires after 5 s instead (P2028), rolled back, so it starts
 * over with a fresh budget. After the last attempt the error is thrown, as
 * the delete's own error was.
 */
export async function deleteProjectInTransaction(
  client: Pick<typeof prisma, "$transaction">,
  projectId: string,
): Promise<RuleCounts> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await client.$transaction((tx) =>
        deleteProjectWithNetworkRows(tx, projectId),
      );
    } catch (error) {
      const expired =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2028";
      if (!expired || attempt >= PROJECT_DELETION_ATTEMPTS) throw error;
    }
  }
}
