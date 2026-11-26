import { PrismaRaw as Prisma } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";

import prisma from "@/lib/db/prisma";

/** Whether the turn aliased `alias` is our own lab work: a `lab:` id or a lab-run record. */
function isLabRoot(alias: string): Prisma.Sql {
  const turn = Prisma.raw(alias);
  return Prisma.sql`(
    COALESCE(${turn}."clientTurnId", '') LIKE 'lab:%'
    OR EXISTS (
      SELECT 1 FROM ${sharedTable("soko_bot_lab_run")} l WHERE l."turnId" = ${turn}."id"
    )
  )`;
}

/**
 * Two CTEs for `WITH RECURSIVE`: `lab_up` walks every turn matching `picked`
 * (a condition on the turn aliased `t`) up through its parents, and
 * `lab_tree` (`id`) holds the picked turns that are lab work, themselves or
 * through any ancestor, however old. A background run has its own
 * `background:` client turn id and may run on a customer's workspace, so only
 * its root tells it is ours.
 */
export function labTurnTree(picked: Prisma.Sql): Prisma.Sql {
  const turns = sharedTable("soko_bot_turn");
  return Prisma.sql`lab_up AS (
    SELECT t."id" AS "start", t."parentTurnId" AS "id"
    FROM ${turns} t
    WHERE ${picked} AND t."parentTurnId" IS NOT NULL
    UNION
    SELECT up."start", p."parentTurnId"
    FROM lab_up up
    JOIN ${turns} p ON p."id" = up."id"
    WHERE p."parentTurnId" IS NOT NULL
  ),
  lab_tree AS (
    SELECT t."id" FROM ${turns} t WHERE ${picked} AND ${isLabRoot("t")}
    UNION
    SELECT up."start"
    FROM lab_up up
    JOIN ${turns} a ON a."id" = up."id"
    WHERE ${isLabRoot("a")}
  )`;
}

/**
 * Which of these turns are lab work: a lab turn itself, or a run below one,
 * however old the root. For turns picked by something other than their
 * creation date, such as a recent rating on an old run.
 */
export async function labRootedTurnIds(
  turnIds: readonly string[],
): Promise<Set<string>> {
  if (turnIds.length === 0) return new Set();
  return new Set(
    await labTurnIdsWhere(Prisma.sql`t."id" = ANY(${[...turnIds]}::uuid[])`),
  );
}

/** The lab work among the turns matching `picked` (a condition on turn `t`). */
export async function labTurnIdsWhere(picked: Prisma.Sql): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ${labTurnTree(picked)}
    SELECT "id" FROM lab_tree
  `;
  return rows.map((row) => row.id);
}
