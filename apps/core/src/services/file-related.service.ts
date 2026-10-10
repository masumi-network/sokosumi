import { FileExtractionState, FileMetadataState } from "@sokosumi/database";
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
 * The floor below which a neighbour is not offered, per matched term.
 *
 * **Per matched term is the whole point of this comment.** `ts_rank` over
 * an OR query divides by the number of OR-ed terms, so the raw figure for
 * one matched term occurring once falls as the seed contributes more
 * vocabulary. Measured:
 *
 * | OR-ed terms | rank, single match |
 * | ----------- | ------------------ |
 * | 1           | 0.0608             |
 * | 5           | 0.0122             |
 * | 8           | 0.0076             |
 *
 * Against a fixed floor of 0.01 that meant this constant silently changed
 * meaning with the seed. At the shipped `RELATED_SEED_TERM_LIMIT` of 8 it
 * dropped **every** neighbour whose only overlap was one term occurring
 * once — 0.0076 against a floor of 0.01 — while two-term overlap survived
 * at 0.0152. The comment this replaces claimed the constant was "set to
 * exclude almost nothing". It excluded the entire single-overlap band, and
 * that band is the distant-but-genuine neighbour the feature exists to
 * surface. `docs ASC` deliberately biases term selection toward rare
 * words, which makes single-term overlap the expected case rather than the
 * edge case.
 *
 * The bug was the coupling, not the number. Nobody chose "the same
 * candidate is or is not a neighbour depending on how broad the seed's
 * vocabulary happens to be", and no value of a fixed floor fixes it. The
 * query now multiplies the rank back by the term count, so the floor means
 * one thing at one term and at eight, and the number below can be reasoned
 * about on its own.
 *
 * ## Why the number is not simply lowered
 *
 * Normalising alone does not settle it, and finding out why is what the
 * measurement was for. On the normalised scale each matched term
 * contributes 0.0608 whatever the seed's width:
 *
 * | matched terms | normalised |
 * | ------------- | ---------- |
 * | 1             | 0.0608     |
 * | 2             | 0.1216     |
 * | 3             | 0.1824     |
 *
 * A floor low enough to admit every single-term match also admits the
 * failure the suite already guards against: in a three-document
 * workspace, kitchen-renovation quotes relate to a reconciliation
 * memorandum because both contain "following", which measures 0.0608 —
 * indistinguishable from a genuine distant neighbour. The old fixed floor
 * excluded that case, but only as a side effect of excluding *every*
 * single-term match, which is the defect being fixed.
 *
 * `ts_rank` cannot tell the two apart, because they are the same event: one
 * term, once. What separates them is the term, so that is where the test
 * goes. A term matched by a document is evidence on its own when it is
 * rare in the corpus — see `rare_tsq` — and otherwise a neighbour needs
 * more than one of them. Hence 0.09, between one match and two.
 *
 * The honest limit: in a corpus this small nothing can tell "following"
 * from "reconciliation", since both appear in two of three documents. The
 * rarity test needs a corpus to work with, which is the same shape as the
 * `simple`-dictionary limitation recorded above. What the number does now
 * is mean one thing regardless of the seed, which it did not before.
 */
const RELATED_MIN_RANK = 0.09;

/**
 * The seed's own words, deduplicated, in the order they first appear.
 *
 * Only a pool of candidates: which of them become the query is decided in
 * SQL by how rare each one is across the corpus. Split on anything that is
 * not a letter or a digit, with Unicode classes rather than `a-z`, so this
 * does not silently discard every term of a non-Latin document.
 */
function seedCandidateTerms(text: string): string[] {
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

export type RelatedState =
  | "ok"
  | "empty"
  | "not-indexed"
  | "no-text"
  | "unavailable";

/**
 * The only extraction states in which "processing has not finished" is a
 * true sentence.
 *
 * Everything else is terminal, and a seed with no chunks in a terminal
 * state has no neighbours coming — not now and not later. A null state is
 * a resource with no version row for its current revision yet, which is
 * genuinely "not started".
 */
const EXTRACTION_STILL_RUNNING: FileExtractionState[] = [
  FileExtractionState.PENDING,
  FileExtractionState.RUNNING,
];

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
    /**
     * No passages, and why that is, rather than only that it is.
     *
     * This answered "not-indexed" for every seed with no chunks, and the
     * API's own description of that value is "processing has not
     * finished". On a scanned PDF that sentence is false: extraction ran,
     * finished, and reported UNSUPPORTED because there is no text layer.
     * The page then said two things at once — the Processing panel
     * explaining that text is not read from images, and Related directly
     * below it promising results when processing finishes. Nothing was
     * coming. The same page shape appears for an image, for an encrypted
     * document, and for a failed extraction.
     *
     * A terminal outcome reported as a pending one is the defect class
     * this feature keeps producing, and a panel that says "wait" forever
     * is the ungraceful way to fail.
     *
     * INDEXED with zero chunks is folded in here deliberately, and it is
     * worth being explicit about: extraction believes it finished and
     * produced nothing. The reader is not the person who can act on that,
     * and telling them to wait is false whatever the cause, so the panel
     * reports terminal — but it is also the one combination here that
     * suggests something upstream went wrong rather than the document
     * simply having no text, so it says so once in the log rather than
     * being silently absorbed.
     */
    const state = seed.extractionState;
    if (state !== null && !EXTRACTION_STILL_RUNNING.includes(state)) {
      if (state === FileExtractionState.INDEXED) {
        console.info("[files] indexed document has no chunks", {
          resourceId: seed.id,
          contentRevision: seed.contentRevision,
          consequence:
            "Reported as having no readable text. Extraction reported " +
            "success, so this is more likely an extraction fault than a " +
            "document without text.",
        });
      }
      return { items: [], state: "no-text" };
    }
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
        -- min(authorized documents with text, probe cap) — never the true
        -- total, which nothing here needs.
        --
        -- Authorized, and that has a consequence worth stating: the
        -- corpus statistic is computed over the rows this actor may read,
        -- so relatedness is per-actor. Two people opening the same file
        -- can see different neighbours, and somebody whose authorized
        -- corpus is two documents gets terms chosen from a two-document
        -- statistic. That is the price of not leaking, and it is the
        -- right trade -- the alternative is a global statistic that tells
        -- a reader something about documents they cannot open -- but it
        -- was nowhere written down. A reviewer confirmed there is no leak:
        -- the predicate is applied in this CTE and in the per-term probe,
        -- each with its own file_resource join.
        --
        -- This counted every authorized document exactly, and it was the
        -- one part of the lookup with no bound at all. The only consumer
        -- is the LEAST() below, which never looks past the probe cap, so
        -- the exact figure was computed and then discarded. Measured at
        -- 2,000 documents: 11.6-15.7 ms exact against 4.1-6.6 ms bounded,
        -- and the bounded form stops growing. I previously recorded this
        -- CTE at 3 ms from a single reading at a small corpus and
        -- dismissed it on that basis; that was not a measurement of the
        -- case that matters.
        --
        -- Counting resources directly, rather than DISTINCT over chunks,
        -- so the LIMIT can stop early instead of de-duplicating the whole
        -- join first.
        SELECT COUNT(*) AS total
        FROM (
          SELECT 1
          FROM file_resource fr
          WHERE ${authorized}
            AND EXISTS (
              SELECT 1
              FROM file_version fv
              JOIN file_chunk fc ON fc."versionId" = fv.id
              WHERE fv."resourceId" = fr.id
            )
          LIMIT ${RELATED_DF_PROBE_CAP}
        ) bounded
      ),
      frequency AS (
        -- Documents, not chunks, and the distinction was a real defect.
        --
        -- This counted matching *chunks*. Every consumer of the number
        -- reasons in documents: docs > 1 below means "some other document
        -- has this word", and the rarity test compares docs against a
        -- corpus measured in documents. With FILE_CHUNK_OVERLAP_CHARS at
        -- 240, a word near a chunk boundary appears in two chunks of the
        -- same file, so a term the seed alone contains reported docs >= 2
        -- and passed a filter designed to exclude exactly that: the seed
        -- competed with itself for the eight seed-term slots, and it won,
        -- because docs ASC sorts those low counts first.
        --
        -- Measured on one 12,000-character document in a two-document
        -- workspace: a term present only in that document reported
        -- docs = 4 against corpus_total = 2. Comparing those two numbers
        -- made the rarity test roughly chunks-per-document times too
        -- strict, in the direction of calling ordinary words rare.
        --
        -- Counting documents costs the same. Measured at 2,000 documents:
        -- 6.2-8.4 ms for this form against 6.2-9.1 ms for the chunk count,
        -- because EXISTS lets the LIMIT stop early just as the chunk
        -- version did. The cheaper unit was also the wrong one, so there
        -- was nothing to trade.
        --
        -- Counting still stops at RELATED_DF_PROBE_CAP per term, and that
        -- bound is what makes this affordable. The count exists only to
        -- tell a rare term from a common one, so an exact count of a
        -- common term is work whose answer is never used: every term at
        -- or above the cap is deprioritised identically.
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
              SELECT 1
              FROM file_resource fr
              WHERE ${authorized}
                AND EXISTS (
                  SELECT 1
                  FROM file_version fv
                  JOIN file_chunk fc ON fc."versionId" = fv.id
                  WHERE fv."resourceId" = fr.id
                    AND fc.search_vector @@ plainto_tsquery('simple', t.word)
                )
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
        -- reintroduced at a different corpus size and just as silent. So
        -- universal terms stay eligible and are simply ordered last,
        -- which docs ASC already does.
        --
        -- It used to do it twice. A leading
        -- (docs >= LEAST(cap, corpus.total)) ASC sat above docs ASC
        -- to sort "appears everywhere it could" to the end. That
        -- expression is true exactly for the largest values of docs, so
        -- it is a monotone function of the very column sorted next and
        -- cannot reorder anything. Checked exhaustively over every
        -- (docs, total) pair in range rather than argued: the orderings
        -- are identical for all forty totals. Deleting a mutation
        -- survivor is the right answer when the survivor is dead code
        -- rather than an untested branch.
        SELECT word, docs, corpus.total AS corpus_total
        FROM frequency, corpus
        WHERE docs > 1
        ORDER BY
          docs ASC,
          length(word) DESC,
          word ASC
        LIMIT ${RELATED_SEED_TERM_LIMIT}
      ),
      q AS (
        SELECT
          to_tsquery('simple', string_agg(word, ' | ')) AS tsq,
          -- Carried out so the floor below can mean the same thing
          -- whatever the seed's vocabulary turned out to be.
          COUNT(*) AS terms,
          -- The subset rare enough that matching one of them is evidence
          -- on its own. NULL when none qualifies, which the HAVING below
          -- handles by falling through to the rank floor.
          --
          -- Both sides are documents. That is worth saying because they
          -- were not: docs counted chunks while corpus_total counted
          -- documents, so this compared quantities in different units and
          -- was chunks-per-document times too strict.
          --
          -- What it means exactly, since "half the corpus" is only half
          -- true: corpus_total is itself capped at
          -- RELATED_DF_PROBE_CAP, so this is "in at most half of the
          -- first 32 authorized documents". Below 32 documents that is
          -- genuinely relative; above it, it is the absolute threshold
          -- docs <= 16, which moves if the cap is retuned. Left
          -- bounded rather than made truly relative, because a real
          -- corpus total is the unbounded count this query was changed
          -- to stop computing — but written down, because the expression
          -- reads relative and stops being so at 32.
          to_tsquery(
            'simple',
            string_agg(word, ' | ')
              FILTER (WHERE docs * 2 <= corpus_total)
          ) AS rare_tsq
        FROM distinctive
      )
      SELECT
        fr.id,
        -- ts_rank over an OR query divides by the number of OR-ed terms,
        -- so multiplying it back out gives a figure comparable across
        -- seeds. See RELATED_MIN_RANK.
        MAX(ts_rank(fc.search_vector, q.tsq)) * q.terms AS rank
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
      GROUP BY fr.id, q.terms
      HAVING
        MAX(ts_rank(fc.search_vector, q.tsq)) * q.terms >= ${RELATED_MIN_RANK}
        -- Or it matched a term rare enough to carry the claim by itself.
        -- Matching against NULL yields NULL and bool_or skips nulls, so
        -- an empty rare set leaves the rank floor as the only test.
        OR bool_or(fc.search_vector @@ q.rare_tsq)
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
    sourceId: resource.sourceId,
    sourceTaskId: resource.sourceTaskId,
    sourceProjectId: resource.sourceProjectId,
    updatedAt: resource.updatedAt,
    contentRevision: resource.contentRevision,
    metadataRevision: resource.metadataRevision,
    extractionState: resource.extractionState,
    extractionCoverage: resource.extractionCoverage,
    exactNameMatch: false,
    ftsRank: null,
    // Related documents match whole-document, not a passage.
    bestChunkId: null,
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
