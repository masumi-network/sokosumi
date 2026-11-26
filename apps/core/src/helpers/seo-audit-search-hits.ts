import { PrismaRaw as Prisma } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";

import prisma from "@/lib/db/prisma";

/**
 * A full audit Task's description ends in a `seo_audit: {json}` line that
 * holds the owner's price terms. `hideSeoAuditRequest` hides it from every
 * reader but the assigned SEO Coworker, so a text search must not find a Task
 * by what only that line holds: a reader could read the terms back one
 * search at a time.
 *
 * SQL twin of the line `removeSeoTaskRequest` removes: a whole line that
 * starts with the marker and holds a `{...}` object (`n` flag: `^`, `$` and
 * `.` work per line). It does not parse the JSON, so a line `seo_audit: {not
 * json}` is also hidden from search. That errs on the safe side.
 */
const SEO_AUDIT_LINE = String.raw`^[ \t]*seo_audit[ \t]*:[ \t]*\{.*\}[ \t\r]*$`;
const SEO_AUDIT_MARKER_LIKE = "%seo_audit%";

/** The tables a description search reads: a Task, or its row in the history list. */
type SearchedTable = "task" | "history";

/**
 * Ids (of `table`) whose description matches `likeTerm` only inside the
 * hidden `seo_audit` line. A search adds them to a `NOT IN` on its description
 * match. `likeTerm` is the text the search passes to Prisma's `contains`
 * (already escaped, when the search escapes it). A row without the marker,
 * the usual case, never enters the list.
 *
 * `rawReaderCoworkerId`: the Coworker that reads raw descriptions of the Tasks
 * assigned to it (the SEO worker); its own Tasks stay searchable by the line.
 */
export async function findSeoAuditOnlyHitIds(
  likeTerm: string,
  {
    table = "task",
    rawReaderCoworkerId,
    client = prisma,
  }: {
    table?: SearchedTable;
    rawReaderCoworkerId?: string | null;
    client?: Pick<typeof prisma, "$queryRaw">;
  } = {},
): Promise<string[]> {
  const pattern = `%${likeTerm}%`;
  const from = sharedTable(table);
  const notRawReader =
    table === "task" && rawReaderCoworkerId
      ? Prisma.sql`AND r."assigneeId" IS DISTINCT FROM ${rawReaderCoworkerId}`
      : Prisma.empty;
  const rows = await client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT r."id" FROM ${from} r
    WHERE r."description" ILIKE ${SEO_AUDIT_MARKER_LIKE}
      AND r."description" ILIKE ${pattern}
      AND regexp_replace(r."description", ${SEO_AUDIT_LINE}, '', 'gni') NOT ILIKE ${pattern}
      ${notRawReader}
  `);
  return rows.map((row) => row.id);
}
