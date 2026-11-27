import { PrismaRaw as Prisma } from "@sokosumi/database/client";
import { sharedTable, sharedType } from "@sokosumi/database/sql-tables";
import prisma from "@/lib/db/prisma";
import type { ListNewsletterIssuesQuery } from "@/schemas/newsletter.schema";
import type { NewsletterScope } from "@/services/newsletter.service";

/** Rank before taking a page so an older subject precedes even the newest body match. */
export async function findNewsletterIssueIds(
  scope: NewsletterScope,
  newsletterId: string,
  query: ListNewsletterIssuesQuery,
  search: string,
  take: number,
): Promise<{ ids: string[]; total: number }> {
  const needle = Prisma.sql`lower(${search})`;
  const [page] = await prisma.$queryRaw<
    Array<{ ids: string[]; total: number }>
  >(Prisma.sql`
    WITH matches AS (
      SELECT id, "createdAt", CASE
        WHEN strpos(lower(subject), ${needle}) > 0 THEN 1
        WHEN strpos(lower("previewText"), ${needle}) > 0 OR EXISTS (
          SELECT FROM jsonb_path_query(content,
            'strict $.** ? (@.type() == "object").keyvalue() ? (@.key == "text" || @.key == "label" || @.key == "alt").value'
          ) AS part WHERE strpos(lower(part #>> '{}'), ${needle}) > 0
        ) THEN 2 END AS rank
      FROM ${sharedTable("newsletter_issue")}
      WHERE "workspaceId" = ${scope.workspaceId}::uuid
        AND "projectId" = ${scope.projectId}::uuid
        AND "newsletterId" = ${newsletterId}::uuid
        ${query.status ? Prisma.sql`AND status = ${query.status}::${sharedType("NewsletterIssueStatus")}` : Prisma.empty}
        ${
          query.from && query.to
            ? Prisma.sql`
          AND coalesce("scheduledAt", "sentAt") >= ${new Date(query.from)}
          AND coalesce("scheduledAt", "sentAt") < ${new Date(query.to)}
        `
            : Prisma.empty
        }
    ), ordered AS (
      SELECT id, row_number() OVER (ORDER BY rank, "createdAt" DESC, id DESC) AS position
      FROM matches WHERE rank IS NOT NULL
    )
    SELECT (SELECT count(*)::int FROM ordered) AS total,
      ARRAY(SELECT id FROM ordered
        ${query.cursor ? Prisma.sql`WHERE position > (SELECT position FROM ordered WHERE id = ${query.cursor}::uuid)` : Prisma.empty}
        ORDER BY position LIMIT ${take}
      ) AS ids
  `);
  return page!;
}
