/**
 * Ranked contact search over `contact_search`: words (full text), typos and
 * parts of words (trigrams), and meaning (embeddings), fused by reciprocal
 * rank. Triggers keep each document current; this embeds stale documents in
 * the background and ranks queries against them.
 */
import { PrismaRaw } from "@sokosumi/database/client";
import { unprocessableEntity } from "@/helpers/error";
import { vectorLiteral } from "@/lib/contacts/embeddings";
import prisma from "@/lib/db/prisma";
import { type EmbedTexts, embedTexts } from "@/lib/embeddings";

export const CONTACT_SEARCH_MODES = ["both", "words", "meaning"] as const;
export type ContactSearchMode = (typeof CONTACT_SEARCH_MODES)[number];

/**
 * Matches each method may contribute: every match, in practice, so totals
 * and paging cover all of them. A query with more is refused, never cut
 * short, so a total is always exact.
 */
const MAX_PER_METHOD = 100_000;
/** Reciprocal rank fusion constant: damps the weight of the very top ranks. */
const RRF_K = 60;
/**
 * Meaning matches below this cosine similarity, or this far below the best
 * one, are noise (measured on real contacts: related ≥ 0.56, unrelated ≤ 0.52).
 */
const MIN_SIMILARITY = 0.55;
const MAX_SIMILARITY_GAP = 0.15;

export interface RankedContact {
  id: string;
  score: number;
}

/**
 * Live contacts of the workspace that match `query`, best first. `ids`
 * narrows the search to contacts a filter already chose. Meaning is skipped
 * when the query cannot be embedded, so a Gateway outage degrades to words.
 */
export async function rankContacts(
  workspaceId: string,
  query: string,
  options: {
    ids?: readonly string[];
    mode?: ContactSearchMode;
    /** Archived contacts instead of live ones. */
    archived?: boolean;
    embed?: EmbedTexts;
    maxPerMethod?: number;
  } = {},
): Promise<RankedContact[]> {
  const mode = options.mode ?? "both";
  const max = options.maxPerMethod ?? MAX_PER_METHOD;
  // One more than allowed, to tell a full result from a cut one.
  const perMethod = max + 1;
  if (options.ids?.length === 0) return [];
  const only = options.ids
    ? PrismaRaw.sql`AND cs."contactId" = ANY(${options.ids}::uuid[])`
    : PrismaRaw.empty;
  const archived = options.archived
    ? PrismaRaw.sql`c."archivedAt" IS NOT NULL`
    : PrismaRaw.sql`c."archivedAt" IS NULL`;
  // Not materialized, so each method's predicate reaches its index.
  const base = PrismaRaw.sql`
    SELECT cs."contactId", cs."document", cs."search_vector", cs."embedding"
    FROM "contact_search" cs
    JOIN "contact" c ON c."id" = cs."contactId"
    WHERE cs."workspaceId" = ${workspaceId}::uuid
      AND c."mergedIntoId" IS NULL
      AND ${archived}
      ${only}`;
  const ranked: { contactId: string; method: string; rank: number }[] = [];
  const add = (rows: typeof ranked) => {
    for (const row of rows) ranked.push(row);
  };
  if (mode !== "meaning")
    add(
      await prisma.$queryRaw<
        { contactId: string; method: string; rank: number }[]
      >`
        WITH q AS (
          SELECT lower(unaccent(${query})) AS text,
            websearch_to_tsquery('simple', lower(unaccent(${query}))) AS tsq
        ),
        base AS NOT MATERIALIZED (${base}),
        words AS (
          SELECT b."contactId", row_number() OVER (
            ORDER BY ts_rank_cd(b."search_vector", q.tsq) DESC, b."contactId"
          ) AS rank
          FROM base b, q
          WHERE b."search_vector" @@ q.tsq
          ORDER BY rank LIMIT ${perMethod}
        ),
        parts AS (
          SELECT b."contactId", row_number() OVER (
            ORDER BY word_similarity(q.text, b."document") DESC, b."contactId"
          ) AS rank
          FROM base b, q
          WHERE q.text <% b."document"
          ORDER BY rank LIMIT ${perMethod}
        )
        SELECT "contactId"::text AS "contactId", 'words' AS method, rank::int AS rank FROM words
        UNION ALL
        SELECT "contactId"::text, 'parts', rank::int FROM parts
      `,
    );
  if (mode !== "words") {
    const vector = await embedQuery(query, options.embed);
    if (vector)
      add(
        await prisma.$queryRaw<
          { contactId: string; method: string; rank: number }[]
        >`
          WITH base AS NOT MATERIALIZED (${base}),
          near AS (
            SELECT b."contactId", 1 - (b."embedding" <=> ${vector}::vector) AS similarity
            FROM base b
            WHERE b."embedding" IS NOT NULL
            ORDER BY b."embedding" <=> ${vector}::vector
            LIMIT ${perMethod}
          ),
          kept AS (
            SELECT n.*, max(n.similarity) OVER () AS best FROM near n
          )
          SELECT "contactId"::text AS "contactId", 'meaning' AS method,
            row_number() OVER (ORDER BY similarity DESC, "contactId")::int AS rank
          FROM kept
          WHERE similarity >= ${MIN_SIMILARITY}
            AND similarity >= best - ${MAX_SIMILARITY_GAP}
        `,
      );
  }
  const counts = new Map<string, number>();
  for (const { method } of ranked)
    counts.set(method, (counts.get(method) ?? 0) + 1);
  if ([...counts.values()].some((count) => count > max))
    throw unprocessableEntity(
      `The search matches more than ${max.toLocaleString("en")} contacts; narrow it with a filter or more words`,
    );
  const scores = new Map<string, number>();
  for (const { contactId, rank } of ranked)
    scores.set(contactId, (scores.get(contactId) ?? 0) + 1 / (RRF_K + rank));
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

async function embedQuery(
  query: string,
  embed: EmbedTexts = embedTexts,
): Promise<string | null> {
  try {
    const [embedding] = (await embed([query.toLowerCase()])).embeddings;
    return embedding ? vectorLiteral(embedding) : null;
  } catch (error) {
    console.error("Contact query embedding failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

/**
 * Embeds up to `limit` live contacts of the workspace whose document changed
 * since it was last embedded. A document that changes meanwhile keeps its
 * stale mark and is embedded on the next run.
 */
export async function embedStaleContacts(
  workspaceId: string,
  options: {
    limit?: number;
    embed?: EmbedTexts;
    /** Checked before each batch: false stops at the run's deadline. */
    shouldContinue?: () => boolean;
  } = {},
): Promise<{ embedded: number; costUsd: number }> {
  const embed = options.embed ?? embedTexts;
  const stale = await prisma.$queryRaw<
    { contactId: string; document: string; hash: string }[]
  >`
    SELECT cs."contactId"::text AS "contactId", cs."document", md5(cs."document") AS hash
    FROM "contact_search" cs
    JOIN "contact" c ON c."id" = cs."contactId"
    WHERE cs."workspaceId" = ${workspaceId}::uuid
      AND c."mergedIntoId" IS NULL
      AND c."archivedAt" IS NULL
      AND cs."embeddedHash" IS DISTINCT FROM md5(cs."document")
    ORDER BY cs."updatedAt" DESC
    LIMIT ${options.limit ?? 500}
  `;
  let embedded = 0;
  let costUsd = 0;
  for (let start = 0; start < stale.length; start += 100) {
    if (options.shouldContinue && !options.shouldContinue()) break;
    const batch = stale.slice(start, start + 100);
    const result = await embed(batch.map((row) => row.document));
    costUsd += result.costUsd;
    const done = batch.flatMap((row, index) => {
      const embedding = result.embeddings[index];
      return embedding ? [{ ...row, vector: vectorLiteral(embedding) }] : [];
    });
    if (done.length === 0) continue;
    // One statement per batch; a document changed meanwhile stays stale.
    embedded += await prisma.$executeRaw`
      UPDATE "contact_search" cs
      SET "embedding" = v.vector::vector, "embeddedHash" = v.hash
      FROM unnest(
        ${done.map((row) => row.contactId)}::uuid[],
        ${done.map((row) => row.vector)}::text[],
        ${done.map((row) => row.hash)}::text[]
      ) AS v(id, vector, hash)
      WHERE cs."contactId" = v.id AND md5(cs."document") = v.hash
    `;
  }
  return { embedded, costUsd };
}

/** Workspaces with live contacts whose search document is not embedded yet. */
export async function workspacesWithStaleEmbeddings(
  limit: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ workspaceId: string }[]>`
    SELECT DISTINCT cs."workspaceId"::text AS "workspaceId"
    FROM "contact_search" cs
    JOIN "contact" c ON c."id" = cs."contactId"
    WHERE c."mergedIntoId" IS NULL
      AND c."archivedAt" IS NULL
      AND cs."embeddedHash" IS DISTINCT FROM md5(cs."document")
    LIMIT ${limit}
  `;
  return rows.map((row) => row.workspaceId);
}
