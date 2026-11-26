import { PrismaRaw as Prisma } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";

import prisma from "@/lib/db/prisma";

/**
 * Background runs end within hours of the turn that started them; a root this
 * much older than the window can still have a child inside it.
 */
const ROOT_MARGIN = Prisma.sql`interval '1 day'`;

/**
 * A recursive CTE named `lab_tree` (`id`, `sokoBotId`): our own lab turns
 * since `since` (a `lab:` client turn id or a lab-run record), and every
 * background run below them. A child has its own `background:` client turn id
 * and may run on a customer's workspace, so only its root tells it is ours.
 * Use it as `WITH RECURSIVE ${labTurnTree(since)}`.
 */
export function labTurnTree(since: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`lab_tree AS (
    SELECT t."id", t."sokoBotId"
    FROM ${sharedTable("soko_bot_turn")} t
    WHERE t."createdAt" >= ${since} - ${ROOT_MARGIN}
      AND (
        COALESCE(t."clientTurnId", '') LIKE 'lab:%'
        OR EXISTS (
          SELECT 1 FROM ${sharedTable("soko_bot_lab_run")} l WHERE l."turnId" = t."id"
        )
      )
    UNION
    SELECT c."id", c."sokoBotId"
    FROM ${sharedTable("soko_bot_turn")} c
    JOIN lab_tree p ON c."sokoBotId" = p."sokoBotId" AND c."parentTurnId" = p."id"
  )`;
}

/** Ids of our lab turns since `since` and of every run they started. */
export async function labTurnIdsSince(since: Date): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE ${labTurnTree(Prisma.sql`${since}::timestamp`)}
    SELECT "id" FROM lab_tree
  `;
  return new Set(rows.map((row) => row.id));
}
