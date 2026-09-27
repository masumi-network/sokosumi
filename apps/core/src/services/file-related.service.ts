import { FileMetadataState } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import {
  buildAuthorizedResourceSql,
  resolveScopeEpoch,
} from "@/lib/files/evidence-scope";
import { rerankFileCandidates } from "@/lib/files/jev-ranking";
import type { FileCandidate } from "@/lib/files/retrieval";
import type { FileResourceDto } from "@/schemas/file-resource.schema";
import {
  hydrateResources,
  type LiveResource,
  loadLiveResources,
} from "@/services/file-search.service";

/**
 * Related documents for one seed.
 *
 * Bounded at every step: at most 40 authorized candidates retrieved, at most
 * 12 ranked, at most 6 returned. The seed's own resource and every version
 * of it are excluded, and reasons use only metadata this reader can already
 * see — a related edge must never be the thing that reveals a label.
 */

export const RELATED_CANDIDATE_LIMIT = 40;
/**
 * How many of the seed's own words are considered as query terms, and how
 * many of those actually become the query.
 *
 * ## What was wrong
 *
 * This query was `plainto_tsquery('simple', <first 2,000 characters of the
 * seed>)`, and `plainto_tsquery` joins every term with **AND**. A candidate
 * chunk therefore had to contain *every word* of the seed. For any real
 * document that is unsatisfiable, so the feature returned nothing — while
 * presenting as a calm "No related files yet", indistinguishable from a
 * document that genuinely has no neighbours.
 *
 * Measured on the preview by varying only the seed's term count: a
 * two-word seed returned `state: "ok"` with a neighbour; a 70-byte file
 * (~11 terms) and a 3.5 KB file both returned `empty`.
 *
 * ## Why this is not simply OR
 *
 * Swapping AND for OR over every term would be a worse failure that looks
 * like success. The stored vectors are built with the **`simple`**
 * dictionary (`file-index.service.ts`, `to_tsvector('simple', …)`), which
 * does no stemming and removes no stopwords, so "the" and "of" are ordinary
 * terms. An OR across a 2,000 character seed would relate every document to
 * every other one through its function words.
 *
 * So the terms are chosen before they are OR-ed, by **document frequency
 * across the authorized corpus**: a word that appears in every document
 * sorts last and never reaches the query, while a word that appears in two
 * sorts first. That is stopword removal derived from the corpus rather than
 * from a hardcoded list, which matters because the list would have to be
 * per-language and the corpus is not guaranteed to be English.
 *
 * ## On the dictionary itself
 *
 * `simple` is a poor choice for relatedness — without stemming,
 * "reconciled" and "reconciliation" are unrelated terms. But it is the
 * dictionary every `search_vector` in the table is already built under, so
 * this query cannot change it unilaterally: a `to_tsquery('english', …)`
 * would produce lexemes that match nothing stored. Changing it means
 * rebuilding every vector and re-tuning search ranking, which is a
 * migration-scale decision and not this fix's to make. Recorded as a known
 * limit rather than quietly accepted.
 */
const RELATED_TERM_POOL = 40;
/**
 * How far each term's document-frequency probe counts before giving up.
 *
 * The probe answers "is this word distinctive here", and any term reaching
 * this many documents is common enough to be deprioritised whatever its
 * true count is. Bounding it turns forty unbounded counts into forty
 * bounded ones and takes the lookup from 1,065 ms at 2,000 documents to
 * something that does not grow with the corpus.
 */
const RELATED_DF_PROBE_CAP = 32;
const RELATED_SEED_TERM_LIMIT = 8;
/** Shorter than this is punctuation or an initial more often than a word. */
const RELATED_MIN_TERM_LENGTH = 3;
/**
 * The floor below which a neighbour is not offered.
 *
 * Deliberately low, and provisional. The primary defence against spurious
 * neighbours is the term selection above, not this number: by the time a
 * query runs it contains only the seed's rarest words. This exists to drop
 * a document that matched exactly one of them, weakly.
 *
 * **It has not been calibrated against real data**, and the risk of setting
 * it too high is precisely the failure being fixed here — an empty result
 * that looks like a considered answer. It is therefore set to exclude
 * almost nothing, and wants a look once there is a corpus worth measuring.
 */
const RELATED_MIN_RANK = 0.01;

/**
 * The seed's own words, deduplicated, in the order they first appear.
 *
 * Only a pool of candidates: which of them become the query is decided in
 * SQL by how rare each one is across the corpus. Split on anything that is
 * not a letter or a digit, with Unicode classes rather than `a-z`, so this
 * does not silently discard every term of a non-Latin document.
 */
export function seedCandidateTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < RELATED_MIN_TERM_LENGTH) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push(token);
    if (terms.length >= RELATED_TERM_POOL) break;
  }

  return terms;
}

export const RELATED_RANK_LIMIT = 12;
export const RELATED_RESULT_LIMIT = 6;

export type RelatedState = "ok" | "empty" | "not-indexed" | "unavailable";

export interface RelatedResult {
  items: FileResourceDto[];
  state: RelatedState;
}

export async function findRelatedFiles(input: {
  workspaceId: string;
  actor: FileActor;
  resourceId: string;
}): Promise<RelatedResult> {
  const seeds = await loadLiveResources({
    workspaceId: input.workspaceId,
    actor: input.actor,
    resourceIds: [input.resourceId],
  });
  const seed = seeds[0];
  if (!seed) return { items: [], state: "empty" };

  const passages = await prisma.fileChunk.findMany({
    where: { version: { resourceId: seed.id, revision: seed.contentRevision } },
    orderBy: { ordinal: "asc" },
    take: 3,
    select: { text: true },
  });

  if (passages.length === 0) {
    return { items: [], state: "not-indexed" };
  }

  const authorized = buildAuthorizedResourceSql({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });

  // Lexical neighbours over the seed's own passages, plus anything sharing a
  // confirmed project or label the reader can see.
  const seedText = passages.map((passage) => passage.text).join(" ");
  const seedTerms = seedCandidateTerms(seedText);

  if (seedTerms.length === 0) return { items: [], state: "empty" };

  const candidates = await prisma.$queryRaw<{ id: string; rank: number }[]>(
    PrismaRaw.sql`
      WITH terms AS (
        SELECT DISTINCT unnest(ARRAY[${PrismaRaw.join(seedTerms)}]::text[]) AS word
      ),
      corpus AS (
        SELECT COUNT(DISTINCT fv."resourceId") AS total
        FROM file_chunk fc
        JOIN file_version fv ON fv.id = fc."versionId"
        JOIN file_resource fr ON fr.id = fv."resourceId"
        WHERE ${authorized}
      ),
      frequency AS (
        -- Counting stops at RELATED_DF_PROBE_CAP per term, and that bound
        -- is what makes this affordable. The count exists only to tell a
        -- rare term from a common one, so an exact count of a common term
        -- is work whose answer is never used: every term at or above the
        -- cap is deprioritised identically.
        --
        -- Without it each of the forty probes counted every matching
        -- chunk in the workspace. Measured: 121 ms at 300 documents,
        -- 1,065 ms at 2,000, growing with the corpus, on a lookup that
        -- runs every time somebody opens a file.
        SELECT
          t.word,
          (
            SELECT COUNT(*)
            FROM (
              SELECT DISTINCT fv."resourceId"
              FROM file_chunk fc
              JOIN file_version fv ON fv.id = fc."versionId"
              JOIN file_resource fr ON fr.id = fv."resourceId"
              WHERE ${authorized}
                AND fc.search_vector @@ plainto_tsquery('simple', t.word)
              LIMIT ${RELATED_DF_PROBE_CAP}
            ) capped
          ) AS docs
        FROM terms t
      ),
      distinctive AS (
        -- Distinctive AND shared, which is not the same as rare. Ordering
        -- by rarity alone picks the words that occur only in the seed, and
        -- those are precisely the words no neighbour can contain, since
        -- the seed is excluded below. Straight IDF answers "what is
        -- unusual about this document"; the question here is "what does
        -- this document have in common with another", so the docs > 1
        -- test drops the seed's private vocabulary.
        --
        -- The other end is a preference, not an exclusion, and the
        -- difference matters. Excluding terms present in every document is
        -- the corpus-derived stopword filter this dictionary lacks, and
        -- the first version of this fix did exactly that. It emptied
        -- related for any workspace holding two documents, because there
        -- every shared term is in every document: the bug being fixed,
        -- reintroduced at a different corpus size and just as silent.
        -- Sorting universal terms last instead means they are used only
        -- when nothing better exists, and the filter can never empty the
        -- set by itself.
        SELECT word
        FROM frequency, corpus
        WHERE docs > 1
        ORDER BY
          -- "Appears everywhere it could" — at the probe cap in a large
          -- corpus, or in literally every document in a small one. LEAST
          -- makes one expression cover both, so the capped count cannot
          -- make a common term look distinctive just because counting
          -- stopped early.
          (docs >= LEAST(${RELATED_DF_PROBE_CAP}, corpus.total)) ASC,
          docs ASC,
          length(word) DESC,
          word ASC
        LIMIT ${RELATED_SEED_TERM_LIMIT}
      ),
      q AS (
        SELECT to_tsquery('simple', string_agg(word, ' | ')) AS tsq
        FROM distinctive
      )
      SELECT fr.id, MAX(ts_rank(fc.search_vector, q.tsq)) AS rank
      FROM file_resource fr
      JOIN file_version fv
        ON fv."resourceId" = fr.id AND fv.revision = fr."contentRevision"
      JOIN file_chunk fc ON fc."versionId" = fv.id
      CROSS JOIN q
      WHERE ${authorized}
        AND q.tsq IS NOT NULL
        AND fr.id <> ${seed.id}::uuid
        AND (fr."lineageId" IS NULL OR fr."lineageId" IS DISTINCT FROM (
          SELECT seed."lineageId" FROM file_resource seed WHERE seed.id = ${seed.id}::uuid
        ))
        AND fc.search_vector @@ q.tsq
      GROUP BY fr.id
      HAVING MAX(ts_rank(fc.search_vector, q.tsq)) >= ${RELATED_MIN_RANK}
      ORDER BY rank DESC
      LIMIT ${RELATED_CANDIDATE_LIMIT}
    `,
  );

  if (candidates.length === 0) return { items: [], state: "empty" };

  const live = await loadLiveResources({
    workspaceId: input.workspaceId,
    actor: input.actor,
    resourceIds: candidates.map((candidate) => candidate.id),
  });
  if (live.length === 0) return { items: [], state: "empty" };

  const rankByResource = new Map(
    candidates.map((candidate) => [candidate.id, candidate.rank]),
  );
  const ordered = [...live].sort(
    (left, right) =>
      (rankByResource.get(right.id) ?? 0) - (rankByResource.get(left.id) ?? 0),
  );

  const epoch = await resolveScopeEpoch({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });

  const ranking = await rerankFileCandidates({
    workspaceId: input.workspaceId,
    actor: input.actor,
    epoch,
    query: "",
    seedPassages: passages.map((passage) => passage.text),
    candidates: ordered.slice(0, RELATED_RANK_LIMIT).map(toCandidate),
  });

  const rankedIds = ranking.candidates.map((candidate) => candidate.resourceId);
  const byId = new Map(live.map((resource) => [resource.id, resource]));
  const chosen = rankedIds
    .slice(0, RELATED_RESULT_LIMIT)
    .map((id) => byId.get(id))
    .filter((resource): resource is LiveResource => Boolean(resource));

  const items = await hydrateResources({ resources: chosen, query: null });

  // A reason is only ever something the reader can already see: a confirmed
  // project or a confirmed label, never a hidden neighbour or a count.
  await attachReasons({ items, seedId: seed.id });

  return { items, state: items.length > 0 ? "ok" : "empty" };
}

function toCandidate(resource: LiveResource): FileCandidate {
  return {
    resourceId: resource.id,
    lineageId: null,
    displayName: resource.displayName,
    normalizedName: resource.normalizedName,
    mimeType: resource.mimeType,
    sizeBytes: resource.sizeBytes,
    sourceKind: resource.sourceKind,
    sourceTaskId: resource.sourceTaskId,
    sourceProjectId: resource.sourceProjectId,
    updatedAt: resource.updatedAt,
    contentRevision: resource.contentRevision,
    metadataRevision: resource.metadataRevision,
    extractionState: resource.extractionState,
    extractionCoverage: resource.extractionCoverage,
    exactNameMatch: false,
    ftsRank: null,
    bestChunkText: resource.bestChunkText,
    bestChunkAnchor: null,
    metadataMatch: false,
    fusedScore: 0,
  };
}

async function attachReasons(input: {
  items: FileResourceDto[];
  seedId: string;
}): Promise<void> {
  if (input.items.length === 0) return;

  const seedLinks = await prisma.fileProjectLink.findMany({
    where: { resourceId: input.seedId, state: FileMetadataState.CONFIRMED },
    select: { projectId: true },
  });
  const seedProjects = new Set(seedLinks.map((link) => link.projectId));

  // The seed's own confirmed tags. "Shares the tag X" used to render the
  // *candidate's* first tag without checking the seed had it, so every
  // related item with any tag carried a claim that was usually false.
  const seedTags = new Set(
    (
      await prisma.fileLabel.findMany({
        where: {
          resourceId: input.seedId,
          state: FileMetadataState.CONFIRMED,
        },
        select: { labelId: true },
      })
    ).map((label) => label.labelId),
  );

  for (const item of input.items) {
    const shared = item.projects.find(
      (link) =>
        link.state === FileMetadataState.CONFIRMED &&
        seedProjects.has(link.projectId),
    );
    if (shared) {
      item.relatedReason = `Same confirmed project · ${shared.projectName}`;
      continue;
    }

    const sharedTag = item.tags.find((tag) => seedTags.has(tag.labelId));
    if (sharedTag) {
      item.relatedReason = `Shares the tag ${sharedTag.displayName}`;
    }
    // No reason rather than a false one: a candidate can be related by
    // content alone, and the list says so by staying quiet.
  }
}
