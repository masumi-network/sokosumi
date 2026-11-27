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

interface FailedHireCleanupRow {
  blockerNetwork: string | null;
  blockerJobId: string | null;
  projects: number;
  // `bucket_0`, `job_0`, `usage_0`, … one per Network that is on.
  [count: string]: number | string | null;
}

/**
 * Whether the foreign key from `child.column` to `parent` still exists, read
 * from the catalog by the statement that uses it. A statement that names the
 * child table locks it first, so a key dropped concurrently is either gone
 * before the statement reads the catalog or dropped after it commits.
 */
function keyExists(
  child: PrismaRaw.Sql,
  column: string,
  parent: PrismaRaw.Sql,
): PrismaRaw.Sql {
  return PrismaRaw.sql`EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    INNER JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass(${child.sql})
      AND c.confrelid = to_regclass(${parent.sql})
      AND a.attname = ${column}
  )`;
}

/**
 * The failed CMO hire's clean-up: deletes the Project made for the hire, which
 * takes its Soko Bots, and the Network rows that pointed at either, in ONE
 * statement. `origin/main` sent one `DELETE`, which the server finishes and
 * commits alone when the client's connection is lost or its time runs out; a
 * transaction the client drives cannot, and keeps the Project and its credit
 * buckets (review of #8509).
 *
 * While a key exists, its sweep changes nothing and the key does the work at
 * the Project's delete: with every key in place the only write is that
 * `DELETE`, so rows, row locks and their order are `origin/main`'s (review of
 * #8549: a sweep running ahead of the cascade reversed the lock order against
 * an account deletion). Once a key is dropped (ticket 54), its sweep runs on
 * the ids the deletes return, and the bots are deleted here so their usage is
 * swept by the ids of the bots really gone. Refuses, deleting nothing, where
 * `Job.creatorSokoBotId` would.
 *
 * What one statement cannot do once the keys are dropped: it sees the rows of
 * its snapshot, not a row a writer commits while it waits (a usage row, a Job
 * hired by the bot or linked to the Project, a bot that joins). The keys
 * caught those with a fresh read; their replacement belongs to ticket 54.
 */
export async function deleteFailedHireProject(
  client: Pick<Prisma.TransactionClient, "$queryRaw">,
  projectId: string,
): Promise<RuleCounts> {
  const networks = networksThatAreOn();
  const project = sharedTable("project");
  const sokoBot = sharedTable("soko_bot");
  const blockers = networks.map(
    (network) => PrismaRaw.sql`
      SELECT ${network}::text AS network, job."id"
      FROM ${netTable(network, "Job")} AS job
      INNER JOIN ${sokoBot} AS bot ON bot."id" = job."creatorSokoBotId"
      WHERE bot."projectId" = ${projectId}::uuid`,
  );
  const usageKeys = networks.map((network) =>
    keyExists(netTable(network, "soko_bot_usage"), "sokoBotId", sokoBot),
  );
  // One name per Network and key; `index` is the Network's place in the list.
  const sweeps = networks.flatMap((network, index) => {
    const bucket = netTable(network, "credit_bucket");
    const job = netTable(network, "Job");
    const usage = netTable(network, "soko_bot_usage");
    return [
      PrismaRaw.sql`${PrismaRaw.raw(`bucket_${index}`)} AS (
        DELETE FROM ${bucket} AS x
        WHERE x."projectId" IN (SELECT "id" FROM gone)
          AND NOT ${keyExists(bucket, "projectId", project)}
        RETURNING 1)`,
      PrismaRaw.sql`${PrismaRaw.raw(`job_${index}`)} AS (
        UPDATE ${job} AS x SET "projectId" = NULL
        WHERE x."projectId" IN (SELECT "id" FROM gone)
          AND NOT ${keyExists(job, "projectId", project)}
        RETURNING 1)`,
      PrismaRaw.sql`${PrismaRaw.raw(`usage_${index}`)} AS (
        DELETE FROM ${usage} AS x
        WHERE x."sokoBotId" IN (SELECT "id" FROM bots)
          AND NOT ${keyExists(usage, "sokoBotId", sokoBot)}
        RETURNING 1)`,
    ];
  });
  // Without the keys these run in the order the list reads them, as
  // PostgreSQL 18 plans it (its docs leave the order open): an observation
  // for ticket 54, not a guarantee. With the keys only `gone` writes.
  const counted = [
    "job_0",
    "bots",
    ...networks.flatMap((_, index) =>
      index === 0 ? ["bucket_0"] : [`job_${index}`, `bucket_${index}`],
    ),
    ...networks.map((_, index) => `usage_${index}`),
  ].map((name) =>
    PrismaRaw.raw(`(SELECT count(*)::int FROM ${name}) AS ${name}`),
  );
  const [result] = await client.$queryRaw<FailedHireCleanupRow[]>`
    WITH blocker AS (
      ${PrismaRaw.join(blockers, " UNION ALL ")}
      LIMIT 1
    ),
    gone AS (
      DELETE FROM ${project} AS project
      WHERE project."id" = ${projectId}::uuid AND NOT EXISTS (SELECT 1 FROM blocker)
      RETURNING project."id"
    ),
    bots AS (
      DELETE FROM ${sokoBot} AS bot
      WHERE bot."projectId" IN (SELECT "id" FROM gone)
        AND NOT (${PrismaRaw.join(usageKeys, " AND ")})
      RETURNING bot."id"
    ),
    ${PrismaRaw.join(sweeps, ",\n")}
    SELECT
      (SELECT network FROM blocker) AS "blockerNetwork",
      (SELECT "id" FROM blocker) AS "blockerJobId",
      (SELECT count(*)::int FROM gone) AS projects,
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
