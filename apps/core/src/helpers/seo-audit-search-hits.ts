import type { Prisma as PrismaTypes } from "@sokosumi/database";
import { PrismaRaw as Prisma } from "@sokosumi/database/client";
import { sharedTable } from "@sokosumi/database/sql-tables";
import { SEO_LINE_SPACE, seoRequestLinePrefix } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";

/**
 * A full audit Task's description ends in a `seo_audit: {json}` line that
 * holds the owner's price terms. `hideSeoAuditRequest` hides it from every
 * reader but the assigned SEO Coworker, so a text search must not find a Task
 * by what only that line holds: a reader could read the terms back one
 * search at a time.
 *
 * A row without the marker text cannot hold the line, so it searches its raw
 * description. A row with the marker matches only through an allow-list of
 * the rows whose visible text holds the term. A row written after that list
 * was read is missed until the next search; it never matches by its line.
 */
const SEO_AUDIT_MARKER = {
  contains: String.raw`seo\_audit`,
  mode: "insensitive",
} as const;
const LINE_PREFIX = seoRequestLinePrefix("seo_audit");
const OUTER_SPACE = `^${SEO_LINE_SPACE}+|${SEO_LINE_SPACE}+$`;

/**
 * Postgres parses JSON by recursion and throws (not a soft error) on deep
 * nesting, near 20,000 levels. A marker line with more `[` and `{` than this
 * is hidden without a parse, so the search fails closed and never errors.
 */
const MAX_JSON_OPENERS = 1000;

/**
 * SQL twin of `hideSeoAuditRequest`: the description without its `seo_audit`
 * lines (the marker, then JSON that is an object or an array), the same text
 * the JS rule returns. A parity test runs the same cases through both.
 * `json`, not `jsonb`: `jsonb` refuses `\u0000` and lone surrogates, which
 * JSON.parse accepts.
 */
export function visibleDescriptionSql(description: Prisma.Sql): Prisma.Sql {
  const rest = Prisma.sql`regexp_replace(s.line, ${LINE_PREFIX}, '', 'i')`;
  return Prisma.sql`(
    SELECT CASE WHEN bool_or(l.hidden)
      THEN regexp_replace(
        coalesce(string_agg(l.line, E'\n' ORDER BY l.n) FILTER (WHERE NOT l.hidden), ''),
        ${OUTER_SPACE}, '', 'g')
      ELSE ${description} END
    FROM (
      SELECT s.line, s.n,
        s.line ~* ${LINE_PREFIX} AND CASE
          WHEN length(${rest}) - length(translate(${rest}, '[{', '')) > ${MAX_JSON_OPENERS}
            THEN true
          WHEN pg_input_is_valid(${rest}, 'json')
            THEN json_typeof(${rest}::json) IN ('object', 'array')
          ELSE false END AS hidden
      FROM regexp_split_to_table(${description}, E'\r?\n') WITH ORDINALITY s(line, n)
    ) l
  )`;
}

/** For each term, the ids of `ids` (rows of `table`) whose visible description contains it. */
async function visibleHits(
  table: "task" | "history",
  ids: string[],
  likeTerms: string[],
  client: Pick<typeof prisma, "$queryRaw">,
): Promise<string[][]> {
  const hits = likeTerms.map((): string[] => []);
  if (ids.length === 0) return hits;
  // One evaluation of the visible text per row, for every term.
  const rows = await client.$queryRaw<{ id: string; terms: number[] }[]>(
    Prisma.sql`
      SELECT r."id", ARRAY(
        SELECT t.n::int FROM unnest(${likeTerms}::text[]) WITH ORDINALITY t(term, n)
        WHERE v.visible ILIKE '%' || t.term || '%'
      ) AS terms
      FROM ${sharedTable(table)} r
      CROSS JOIN LATERAL (
        SELECT ${visibleDescriptionSql(Prisma.sql`r."description"`)} AS visible
      ) v
      WHERE r."id" = ANY(${ids}::text[])
    `,
  );
  for (const row of rows) for (const n of row.terms) hits[n - 1].push(row.id);
  return hits;
}

const contains = (likeTerm: string) =>
  ({ contains: likeTerm, mode: "insensitive" }) as const;

/**
 * Per term, a Task filter for "the description a reader sees contains it".
 * `likeTerms` are the texts the search passes to Prisma's `contains` (already
 * escaped, when the search escapes them). `scope` is the reader's own Task
 * filter, so the allow-list holds only rows the reader may list.
 *
 * `rawReaderCoworkerId`: the Coworker that reads raw descriptions of the Tasks
 * assigned to it (the SEO worker); its own Tasks stay searchable by the line.
 */
export async function taskDescriptionMatches(
  likeTerms: string[],
  scope: PrismaTypes.TaskWhereInput,
  {
    rawReaderCoworkerId,
    client = prisma,
  }: {
    rawReaderCoworkerId?: string | null;
    client?: Pick<typeof prisma, "$queryRaw" | "task">;
  } = {},
): Promise<PrismaTypes.TaskWhereInput[]> {
  const candidates =
    likeTerms.length === 0
      ? []
      : await client.task.findMany({
          where: {
            AND: [
              scope,
              { description: SEO_AUDIT_MARKER },
              {
                OR: likeTerms.map((term) => ({ description: contains(term) })),
              },
            ],
          },
          select: { id: true },
        });
  const hits = await visibleHits(
    "task",
    candidates.map((row) => row.id),
    likeTerms,
    client,
  );
  return likeTerms.map((term, at) => ({
    OR: [
      // `not: null` keeps a NOT of this filter true for a Task without a
      // description: in SQL, NOT of a match on NULL is NULL and drops the row.
      {
        description: { ...contains(term), not: null },
        NOT: { description: SEO_AUDIT_MARKER },
      },
      ...(rawReaderCoworkerId
        ? [
            {
              description: { ...contains(term), not: null },
              assigneeId: { equals: rawReaderCoworkerId, not: null },
            },
          ]
        : []),
      ...(hits[at].length > 0 ? [{ id: { in: hits[at] } }] : []),
    ],
  }));
}

/** The history twin of `taskDescriptionMatches`, for one term. */
export async function historyDescriptionMatch(
  likeTerm: string,
  scope: PrismaTypes.HistoryWhereInput,
  client: Pick<typeof prisma, "$queryRaw" | "history">,
): Promise<PrismaTypes.HistoryWhereInput> {
  const candidates = await client.history.findMany({
    where: {
      AND: [
        scope,
        { description: SEO_AUDIT_MARKER },
        { description: contains(likeTerm) },
      ],
    },
    select: { id: true },
  });
  const [hits] = await visibleHits(
    "history",
    candidates.map((row) => row.id),
    [likeTerm],
    client,
  );
  return {
    OR: [
      {
        description: { ...contains(likeTerm), not: null },
        NOT: { description: SEO_AUDIT_MARKER },
      },
      ...(hits.length > 0 ? [{ id: { in: hits } }] : []),
    ],
  };
}
