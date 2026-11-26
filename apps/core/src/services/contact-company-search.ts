import { PrismaRaw } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { literalSubstringPattern } from "@/helpers/project-activity";
import prisma from "@/lib/db/prisma";
import type {
  COMPANY_SORTS,
  CompanySummary,
} from "@/services/contact-companies.service";
import { contactCompaniesCte } from "@/services/contacts.service";

export interface CompanyStats {
  key: string;
  /** The group's name as lowercase letters and digits ("acmerobotics"). */
  org: string | null;
  spelling: string | null;
  domain: string | null;
  /** Every spelling its people write, as lowercase letters and digits. */
  orgs: string[];
  people: number;
  teammates: number;
  interactions: number;
  lastContactAt: Date | null;
  stages: string[];
}

/**
 * Every company the workspace's live contacts work at, with what the team's
 * contact with its people adds up to. Gives each new group its row first, so
 * every company has an id to read and edit.
 */
export async function companyStats(
  workspaceId: string,
  options: { search?: string; name?: string; keys?: readonly string[] } = {},
): Promise<CompanyStats[]> {
  const named = (pattern: string) => PrismaRaw.sql`a.key IN (
      SELECT cc.key FROM ${sharedTable("contact_company")} cc
      WHERE cc."workspaceId" = ${workspaceId}::uuid AND cc.name ILIKE ${pattern} ESCAPE '\\'
    )`;
  const pattern = options.search
    ? literalSubstringPattern(options.search)
    : undefined;
  const search = pattern
    ? PrismaRaw.sql`HAVING bool_or(a.raw ILIKE ${pattern} ESCAPE '\\')
        OR bool_or(a.key ILIKE ${pattern} ESCAPE '\\')
        OR a.key IN (
          SELECT cc.key FROM ${sharedTable("contact_company")} cc
          WHERE cc."workspaceId" = ${workspaceId}::uuid AND (
            cc.name ILIKE ${pattern} OR cc.description ILIKE ${pattern}
            OR cc.industry ILIKE ${pattern} OR cc.headquarters ILIKE ${pattern}
          )
        )`
    : PrismaRaw.empty;
  // Exactly the company a name belongs to, as the contact filter reads it.
  const name = options.name
    ? PrismaRaw.sql`AND (a.key IN (
        SELECT key FROM assigned
        WHERE org = regexp_replace(lower(${options.name}), '[^[:alnum:]]+', '', 'g')
      ) OR ${named(options.name.trim().replace(/[\\%_]/g, "\\$&"))})`
    : PrismaRaw.empty;
  const keys = options.keys
    ? PrismaRaw.sql`AND a.key = ANY(${options.keys}::text[])`
    : PrismaRaw.empty;
  return prisma.$queryRaw<CompanyStats[]>`
    ${contactCompaniesCte(workspaceId)}
    SELECT a.key, min(a.cluster_org) AS org,
      mode() WITHIN GROUP (ORDER BY a.raw) FILTER (WHERE a.org = a.cluster_org) AS spelling,
      CASE WHEN a.key LIKE 'd:%' THEN substr(a.key, 3) END AS domain,
      coalesce(array_agg(DISTINCT a.org) FILTER (WHERE a.org <> ''), '{}') AS orgs,
      count(*)::int AS people,
      (SELECT count(DISTINCT i."userId")::int FROM ${sharedTable("contact_interaction")} i
        WHERE i."contactId" = ANY(array_agg(a.id)) AND i."userId" IS NOT NULL) AS teammates,
      sum(c."interactionCount")::int AS interactions,
      max(c."lastContactAt") AS "lastContactAt",
      array_agg(DISTINCT c.stage::text) AS stages
    FROM assigned a
    JOIN ${sharedTable("contact")} c ON c.id = a.id
    WHERE a.key IS NOT NULL ${keys} ${name}
    GROUP BY a.key
    ${search}
  `;
}

export function sortCompanies(
  items: CompanySummary[],
  sort: (typeof COMPANY_SORTS)[number],
  search?: string,
) {
  items.sort((a, b) =>
    sort === "name"
      ? a.name.localeCompare(b.name)
      : sort === "lastContact"
        ? (b.lastContactAt?.getTime() ?? 0) - (a.lastContactAt?.getTime() ?? 0)
        : b.people - a.people || a.name.localeCompare(b.name),
  );
  if (search) {
    const text = search.toLowerCase();
    items.sort(
      (a, b) =>
        Number(b.name.toLowerCase().includes(text)) -
        Number(a.name.toLowerCase().includes(text)),
    );
  }
}
