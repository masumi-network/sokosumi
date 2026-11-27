import type { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { netTable, sharedTable } from "@sokosumi/database/sql-tables";
import { createError } from "evlog";

import {
  applyRulesAfterDelete,
  type RuleCounts,
} from "@/helpers/user-deletion-crossing-rules";
import { networksThatAreOn } from "@/lib/network";

/**
 * The keys of `src/lib/db/crossing-keys.ts` owned by the Soko Bot deletion
 * and the failed CMO hire, done by Core in every Network that is on, by the
 * rule of `user-deletion-crossing-rules.ts`: a refusal before the parent's
 * delete, a cascade after it and only where the parent is gone.
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
 * The failed CMO hire's clean-up: deletes the Project made for the hire, which
 * takes its Soko Bots, and the Network rows that pointed at either, in ONE
 * statement. `origin/main` sent one `DELETE`, which the server finishes and
 * commits alone when the client's connection is lost or its time runs out; a
 * transaction the client drives cannot, and keeps the Project and its credit
 * buckets (review of #8509).
 *
 * The exception to the rule above, for this statement only: inside one
 * statement every part reads the snapshot taken before the Project's delete,
 * and the keys act after the whole statement, so "only where the parent is
 * gone" cannot be seen. The sweeps are keyed on the ids the deletes return
 * instead. While the keys exist they change the rows first (1 each, not 0)
 * and the keys find none left; the PostgreSQL tests hold the end state to
 * `origin/main`'s `DELETE` on every table, with the keys and without them.
 *
 * The bots are deleted here, not left to their key, because the usage sweep
 * needs the ids of the bots really gone: a bot that left the Project while
 * the statement waited keeps its usage. Refuses, deleting nothing, where
 * `Job.creatorSokoBotId` would.
 */
interface FailedHireCleanupRow {
  blockerNetwork: string | null;
  blockerJobId: string | null;
  projects: number;
  // `bucket_0`, `job_0`, `usage_0`, … one per Network that is on.
  [count: string]: number | string | null;
}

export async function deleteFailedHireProject(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  projectId: string,
): Promise<RuleCounts> {
  const networks = networksThatAreOn();
  const blockers = networks.map(
    (network) => PrismaRaw.sql`
      SELECT ${network}::text AS network, job."id"
      FROM ${netTable(network, "Job")} AS job
      INNER JOIN ${sharedTable("soko_bot")} AS bot ON bot."id" = job."creatorSokoBotId"
      WHERE bot."projectId" = ${projectId}::uuid`,
  );
  // One name per Network and key; `index` is the Network's place in the list.
  const sweeps = networks.flatMap((network, index) => [
    PrismaRaw.sql`${PrismaRaw.raw(`bucket_${index}`)} AS (
      DELETE FROM ${netTable(network, "credit_bucket")} AS x
      WHERE x."projectId" IN (SELECT "id" FROM gone) RETURNING 1)`,
    PrismaRaw.sql`${PrismaRaw.raw(`job_${index}`)} AS (
      UPDATE ${netTable(network, "Job")} AS x SET "projectId" = NULL
      WHERE x."projectId" IN (SELECT "id" FROM gone) RETURNING 1)`,
    PrismaRaw.sql`${PrismaRaw.raw(`usage_${index}`)} AS (
      DELETE FROM ${netTable(network, "soko_bot_usage")} AS x
      WHERE x."sokoBotId" IN (SELECT "id" FROM bots) RETURNING 1)`,
  ]);
  const counted = networks.flatMap((_, index) =>
    ["bucket", "job", "usage"].map((name) =>
      PrismaRaw.raw(
        `(SELECT count(*)::int FROM ${name}_${index}) AS ${name}_${index}`,
      ),
    ),
  );
  const [result] = await client.$queryRaw<FailedHireCleanupRow[]>`
    WITH blocker AS (
      ${PrismaRaw.join(blockers, " UNION ALL ")}
      LIMIT 1
    ),
    gone AS (
      DELETE FROM ${sharedTable("project")} AS project
      WHERE project."id" = ${projectId}::uuid AND NOT EXISTS (SELECT 1 FROM blocker)
      RETURNING project."id"
    ),
    bots AS (
      DELETE FROM ${sharedTable("soko_bot")} AS bot
      WHERE bot."projectId" IN (SELECT "id" FROM gone)
      RETURNING bot."id"
    ),
    ${PrismaRaw.join(sweeps, ",\n")}
    SELECT
      (SELECT network FROM blocker) AS "blockerNetwork",
      (SELECT "id" FROM blocker) AS "blockerJobId",
      (SELECT count(*)::int FROM gone) AS projects,
      (SELECT count(*)::int FROM bots) AS bots,
      ${PrismaRaw.join(counted, ",\n")}
  `;
  if (result.blockerJobId) {
    // Follow-up (ticket 26, decision D5): the key refused this delete with
    // its raw error; the refusal stays, readable.
    throw createError({
      code: "PROJECT_DELETION_SOKO_BOT_HIRED_JOB",
      message:
        "A Job hired by the Project's Soko Bot blocks deleting the Project",
      why: "A Job names one of the Project's Soko Bots as its creator",
      fix: "Keep the Project, or remove the Job's creator link by hand first",
      // Ids only in id-named fields: redaction masks them anywhere else.
      data: {
        projectId,
        jobId: result.blockerJobId,
        network: result.blockerNetwork,
      },
    });
  }
  if (result.projects === 0) {
    throw createError({
      code: "PROJECT_NOT_FOUND",
      message: "The failed hire's Project was already gone",
      why: "No Project has the id the hire created",
      fix: "Nothing to clean up; check who deleted the Project",
      data: { projectId },
    });
  }
  const counts: RuleCounts = {};
  networks.forEach((_, index) => {
    for (const [name, key] of [
      ["bucket", "credit_bucket.projectId"],
      ["job", "Job.projectId"],
      ["usage", "soko_bot_usage.sokoBotId"],
    ]) {
      counts[key] = (counts[key] ?? 0) + Number(result[`${name}_${index}`]);
    }
  });
  return counts;
}
