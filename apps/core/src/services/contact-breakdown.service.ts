/**
 * How many contacts match, and how they split: by stage, company, place,
 * role, list, teammate, channel or recency. Lets a Soko Bot (and a list
 * overview) answer "how many investors per city" in one call instead of
 * paging through thousands of contacts.
 */
import { PrismaRaw } from "@sokosumi/database/client";
import type { ContactFilter } from "@sokosumi/utils";
import prisma from "@/lib/db/prisma";
import {
  type ContactSearchMode,
  rankContacts,
} from "@/services/contact-search.service";
import {
  type ContactActor,
  contactIdsWhere,
  contactListWhere,
} from "@/services/contacts.service";

export const CONTACT_BREAKDOWNS = [
  "stage",
  "kind",
  "organization",
  "location",
  "role",
  "list",
  "knownBy",
  "channel",
  "source",
  "lastContact",
] as const;
export type ContactBreakdown = (typeof CONTACT_BREAKDOWNS)[number];

export interface ContactBreakdownGroup {
  /** The value; null for contacts without one (no company, never contacted…). */
  key: string | null;
  label: string;
  count: number;
}

export interface ContactBreakdownResult {
  total: number;
  groups: ContactBreakdownGroup[];
  /** Groups beyond `top`, so a cut list is never mistaken for a full one. */
  otherGroups: number;
}

/** Which contacts: the same filter, list, company and query as a search. */
export interface ContactSet {
  filter: ContactFilter;
  listId?: string;
  company?: string;
  archived?: boolean;
  query?: string;
  mode?: ContactSearchMode;
}

export async function breakDownContacts(
  actor: ContactActor,
  options: ContactSet & { by?: ContactBreakdown; top?: number },
): Promise<ContactBreakdownResult> {
  const ids = await matchingIds(actor, options);
  if (!options.by || ids.length === 0)
    return { total: ids.length, groups: [], otherGroups: 0 };
  const groups = await groupsBy(actor, options.by, ids);
  const top = options.top ?? 20;
  return {
    total: ids.length,
    groups: groups.slice(0, top),
    otherGroups: Math.max(0, groups.length - top),
  };
}

/** Several breakdowns of one set, read once: a list overview. */
export async function breakDownContactsBy(
  actor: ContactActor,
  options: ContactSet & { by: readonly ContactBreakdown[]; top?: number },
): Promise<{
  total: number;
  breakdowns: ({ by: ContactBreakdown } & Omit<
    ContactBreakdownResult,
    "total"
  >)[];
}> {
  const ids = await matchingIds(actor, options);
  const top = options.top ?? 20;
  const breakdowns = await Promise.all(
    options.by.map(async (by) => {
      const groups = ids.length ? await groupsBy(actor, by, ids) : [];
      return {
        by,
        groups: groups.slice(0, top),
        otherGroups: Math.max(0, groups.length - top),
      };
    }),
  );
  return { total: ids.length, breakdowns };
}

/**
 * Every contact the filter, list and query admit: a query counts all its
 * matches, not just the best page of them.
 */
export async function matchingIds(
  actor: ContactActor,
  options: ContactSet,
): Promise<string[]> {
  const where = await contactListWhere(actor, options);
  if (!options.query)
    return (await prisma.contact.findMany({ where, select: { id: true } })).map(
      (row) => row.id,
    );
  const ranked = await rankContacts(actor.workspaceId, options.query, {
    ids: await contactIdsWhere(options, where),
    mode: options.mode,
    archived: options.archived,
  });
  return ranked.map((entry) => entry.id);
}

const COLUMNS = {
  stage: PrismaRaw.sql`c."stage"::text`,
  kind: PrismaRaw.sql`c."kind"::text`,
  organization: PrismaRaw.sql`c."organization"`,
  location: PrismaRaw.sql`c."location"`,
  role: PrismaRaw.sql`c."role"`,
} as const;

/** Each group of `ids`, one query, the ids as one array parameter. */
async function groupsBy(
  actor: ContactActor,
  by: ContactBreakdown,
  ids: string[],
): Promise<ContactBreakdownGroup[]> {
  switch (by) {
    case "stage":
    case "kind": {
      const rows = await countBy(COLUMNS[by], ids);
      return sorted(
        rows.map((row) => ({
          key: row.value,
          label: row.value ?? "(none)",
          count: row.count,
        })),
      );
    }
    case "organization":
    case "location":
    case "role":
      return mergedText(await countBy(COLUMNS[by], ids));
    case "lastContact":
      return lastContactGroups(ids);
    case "list":
      return listGroups(actor, ids);
    case "knownBy":
      return sorted(
        await prisma.$queryRaw<ContactBreakdownGroup[]>`
          SELECT i."userId" AS key, coalesce(u."name", 'A teammate') AS label,
            count(DISTINCT i."contactId")::int AS count
          FROM "contact_interaction" i
          LEFT JOIN "user" u ON u."id" = i."userId"
          WHERE i."contactId" = ANY(${ids}::uuid[]) AND i."userId" IS NOT NULL
          GROUP BY i."userId", u."name"
        `,
      );
    case "channel":
    case "source": {
      const column =
        by === "channel"
          ? PrismaRaw.sql`ch."type"::text`
          : PrismaRaw.sql`ch."source"::text`;
      return sorted(
        await prisma.$queryRaw<ContactBreakdownGroup[]>`
          SELECT ${column} AS key, ${column} AS label,
            count(DISTINCT ch."contactId")::int AS count
          FROM "contact_channel" ch
          WHERE ch."contactId" = ANY(${ids}::uuid[])
          GROUP BY 1
        `,
      );
    }
  }
}

function countBy(column: PrismaRaw.Sql, ids: string[]) {
  return prisma.$queryRaw<{ value: string | null; count: number }[]>`
    SELECT ${column} AS value, count(*)::int AS count
    FROM "contact" c
    WHERE c."id" = ANY(${ids}::uuid[])
    GROUP BY 1
  `;
}

function sorted(groups: ContactBreakdownGroup[]): ContactBreakdownGroup[] {
  return groups.sort(
    (a, b) =>
      b.count - a.count ||
      Number(a.key === null) - Number(b.key === null) ||
      a.label.localeCompare(b.label),
  );
}

/** Free text grouped case- and space-insensitively, under its most used spelling. */
function mergedText(
  rows: { value: string | null; count: number }[],
): ContactBreakdownGroup[] {
  const groups = new Map<
    string | null,
    { count: number; spellings: Map<string, number> }
  >();
  for (const { value, count } of rows) {
    const trimmed = value?.trim() || null;
    const key = trimmed?.toLowerCase().replace(/\s+/g, " ") ?? null;
    const group = groups.get(key) ?? { count: 0, spellings: new Map() };
    group.count += count;
    if (trimmed)
      group.spellings.set(trimmed, (group.spellings.get(trimmed) ?? 0) + count);
    groups.set(key, group);
  }
  return sorted(
    [...groups].map(([key, group]) => ({
      key,
      label:
        [...group.spellings].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "(none)",
      count: group.count,
    })),
  );
}

const RECENCY = [
  { key: "30d", label: "In the last 30 days" },
  { key: "90d", label: "30–90 days ago" },
  { key: "365d", label: "90 days to a year ago" },
  { key: "older", label: "More than a year ago" },
  { key: null, label: "Never" },
] as const;

async function lastContactGroups(
  ids: string[],
): Promise<ContactBreakdownGroup[]> {
  const rows = await prisma.$queryRaw<{ key: string | null; count: number }[]>`
    SELECT CASE
        WHEN c."lastContactAt" IS NULL THEN NULL
        WHEN c."lastContactAt" >= now() - interval '30 days' THEN '30d'
        WHEN c."lastContactAt" >= now() - interval '90 days' THEN '90d'
        WHEN c."lastContactAt" >= now() - interval '365 days' THEN '365d'
        ELSE 'older'
      END AS key,
      count(*)::int AS count
    FROM "contact" c
    WHERE c."id" = ANY(${ids}::uuid[])
    GROUP BY 1
  `;
  const counts = new Map(rows.map((row) => [row.key, row.count]));
  return RECENCY.flatMap((bucket) => {
    const count = counts.get(bucket.key) ?? 0;
    return count > 0 ? [{ key: bucket.key, label: bucket.label, count }] : [];
  });
}

/** Manual lists by membership; smart lists by their own filter, intersected. */
async function listGroups(
  actor: ContactActor,
  ids: string[],
): Promise<ContactBreakdownGroup[]> {
  const lists = await prisma.contactList.findMany({
    where: { workspaceId: actor.workspaceId },
    select: { id: true, name: true, smartFilter: true },
  });
  const manual = await prisma.$queryRaw<{ listId: string; count: number }[]>`
    SELECT m."listId"::text AS "listId", count(*)::int AS count
    FROM "contact_list_member" m
    WHERE m."contactId" = ANY(${ids}::uuid[])
    GROUP BY 1
  `;
  const manualCounts = new Map(manual.map((row) => [row.listId, row.count]));
  const chosen = new Set(ids);
  const groups = await Promise.all(
    lists.map(async (list) => {
      if (list.smartFilter === null)
        return {
          key: list.id,
          label: list.name,
          count: manualCounts.get(list.id) ?? 0,
        };
      const members = await prisma.contact.findMany({
        where: await contactListWhere(actor, { filter: {}, listId: list.id }),
        select: { id: true },
      });
      return {
        key: list.id,
        label: list.name,
        count: members.filter((member) => chosen.has(member.id)).length,
      };
    }),
  );
  return sorted(groups.filter((group) => group.count > 0));
}
