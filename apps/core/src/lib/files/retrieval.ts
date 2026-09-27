import {
  type FileExtractionState,
  FileMetadataState,
  type FileSourceKind,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { normalizeFileResourceName } from "@sokosumi/utils";

import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import { buildAuthorizedResourceSql } from "@/lib/files/evidence-scope";

/**
 * Candidate retrieval over the authorized relation.
 *
 * Authorization is applied *before* every limit, so a budget can only return
 * fewer authorized rows and never a wider scope. Three bounded strategies run
 * independently and are fused; a normalized exact filename match is protected
 * and always precedes everything a model could say.
 *
 * Postgres full-text ranking is FTS, not BM25. It is called FTS here because
 * that is what it is.
 */

export const CANDIDATE_BUDGET_EXACT_NAME = 20;
export const CANDIDATE_BUDGET_FTS_CHUNKS = 100;
export const CANDIDATE_BUDGET_METADATA = 40;
/** The bounded window everything downstream operates on. */
export const RESULT_WINDOW_LIMIT = 120;
/** Reciprocal-rank-fusion constant. A tuning default, not a measurement. */
export const RRF_K = 60;

export type FileSortBy = "relevance" | "modified" | "name";
export type FileSortOrder = "asc" | "desc";

export interface FileSearchFilters {
  categoryLabelIds?: string[];
  tagLabelIds?: string[];
  tagMatch?: "any" | "all";
  projectIds?: string[];
  sourceKinds?: FileSourceKind[];
  /** Coarse type families, matched against the stored MIME type. */
  typeFamilies?: string[];
  modifiedAfter?: Date;
  modifiedBefore?: Date;
  extractionStates?: FileExtractionState[];
  creatorUserIds?: string[];
}

export interface FileCandidate {
  resourceId: string;
  lineageId: string | null;
  displayName: string;
  normalizedName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceKind: FileSourceKind;
  sourceTaskId: string | null;
  sourceProjectId: string | null;
  updatedAt: Date;
  contentRevision: number;
  metadataRevision: number;
  extractionState: FileExtractionState | null;
  extractionCoverage: number | null;
  /** Exactly the normalized query. Protected: always ordered first. */
  exactNameMatch: boolean;
  ftsRank: number | null;
  bestChunkText: string | null;
  bestChunkAnchor: unknown;
  metadataMatch: boolean;
  fusedScore: number;
}

const TYPE_FAMILY_PATTERNS: Record<string, string[]> = {
  document: ["application/pdf", "text/", "application/vnd.openxmlformats"],
  image: ["image/"],
  video: ["video/"],
  audio: ["audio/"],
  data: ["text/csv", "application/json", "application/vnd.ms-excel"],
};

function buildFiltersSql(filters: FileSearchFilters): PrismaRaw.Sql {
  const clauses: PrismaRaw.Sql[] = [];

  if (filters.sourceKinds?.length) {
    clauses.push(
      PrismaRaw.sql`fr."sourceKind"::text = ANY(${filters.sourceKinds.map(String)})`,
    );
  }

  if (filters.modifiedAfter) {
    clauses.push(PrismaRaw.sql`fr."updatedAt" >= ${filters.modifiedAfter}`);
  }
  if (filters.modifiedBefore) {
    clauses.push(PrismaRaw.sql`fr."updatedAt" <= ${filters.modifiedBefore}`);
  }

  if (filters.creatorUserIds?.length) {
    clauses.push(
      PrismaRaw.sql`fr."ownerUserId" = ANY(${filters.creatorUserIds})`,
    );
  }

  if (filters.typeFamilies?.length) {
    const prefixes = filters.typeFamilies.flatMap(
      (family) => TYPE_FAMILY_PATTERNS[family] ?? [],
    );
    if (prefixes.length === 0) {
      clauses.push(PrismaRaw.sql`FALSE`);
    } else {
      clauses.push(
        PrismaRaw.sql`EXISTS (
          SELECT 1 FROM unnest(${prefixes}::text[]) AS prefix
          WHERE fr."mimeType" LIKE prefix || '%'
        )`,
      );
    }
  }

  if (filters.extractionStates?.length) {
    clauses.push(PrismaRaw.sql`EXISTS (
      SELECT 1 FROM file_version fv
      WHERE fv."resourceId" = fr.id
        AND fv.revision = fr."contentRevision"
        AND fv."extractionState"::text = ANY(${filters.extractionStates.map(String)})
    )`);
  }

  // Metadata filters narrow an already-authorized set: every row these
  // clauses can reach has passed `buildAuthorizedResourceSql` above.
  //
  // They do **not** join the evidence scope. An earlier comment here claimed
  // the scope join stopped a partial reader narrowing a list with a label
  // they were not allowed to know about; it does not, and `scopeVersion` is
  // never advanced, so it could not. See the note in `evidence-scope.ts`.
  if (filters.categoryLabelIds?.length) {
    clauses.push(PrismaRaw.sql`EXISTS (
      SELECT 1 FROM file_label fl
      WHERE fl."resourceId" = fr.id
        AND fl.state = ${FileMetadataState.CONFIRMED}::"FileMetadataState"
        AND fl."labelId"::text = ANY(${filters.categoryLabelIds})
    )`);
  }

  if (filters.tagLabelIds?.length) {
    const tagIds = filters.tagLabelIds;
    if (filters.tagMatch === "all") {
      clauses.push(PrismaRaw.sql`(
        SELECT COUNT(DISTINCT fl."labelId") FROM file_label fl
        WHERE fl."resourceId" = fr.id
          AND fl.state = ${FileMetadataState.CONFIRMED}::"FileMetadataState"
          AND fl."labelId"::text = ANY(${tagIds})
      ) = ${tagIds.length}`);
    } else {
      clauses.push(PrismaRaw.sql`EXISTS (
        SELECT 1 FROM file_label fl
        WHERE fl."resourceId" = fr.id
          AND fl.state = ${FileMetadataState.CONFIRMED}::"FileMetadataState"
          AND fl."labelId"::text = ANY(${tagIds})
      )`);
    }
  }

  if (filters.projectIds?.length) {
    clauses.push(PrismaRaw.sql`EXISTS (
      SELECT 1 FROM file_project_link fpl
      WHERE fpl."resourceId" = fr.id
        AND fpl.state = ${FileMetadataState.CONFIRMED}::"FileMetadataState"
        AND fpl."projectId"::text = ANY(${filters.projectIds})
    )`);
  }

  if (clauses.length === 0) return PrismaRaw.sql`TRUE`;
  return PrismaRaw.join(clauses, " AND ");
}

interface RawResourceRow {
  id: string;
  lineageId: string | null;
  displayName: string;
  normalizedName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceKind: FileSourceKind;
  sourceTaskId: string | null;
  sourceProjectId: string | null;
  updatedAt: Date;
  contentRevision: number;
  metadataRevision: number;
  extractionState: FileExtractionState | null;
  extractionCoverage: number | null;
}

const RESOURCE_COLUMNS = PrismaRaw.sql`
  fr.id,
  fr."lineageId",
  fr."displayName",
  fr."normalizedName",
  fr."mimeType",
  fr."sizeBytes",
  fr."sourceKind",
  fr."sourceTaskId",
  fr."sourceProjectId",
  fr."updatedAt",
  fr."contentRevision",
  fr."metadataRevision",
  fv."extractionState",
  fv."extractionCoverage"
`;

const CURRENT_VERSION_JOIN = PrismaRaw.sql`
  LEFT JOIN file_version fv
    ON fv."resourceId" = fr.id AND fv.revision = fr."contentRevision"
`;

function toCandidate(row: RawResourceRow): FileCandidate {
  return {
    resourceId: row.id,
    lineageId: row.lineageId,
    displayName: row.displayName,
    normalizedName: row.normalizedName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    sourceKind: row.sourceKind,
    sourceTaskId: row.sourceTaskId,
    sourceProjectId: row.sourceProjectId,
    updatedAt: row.updatedAt,
    contentRevision: row.contentRevision,
    metadataRevision: row.metadataRevision,
    extractionState: row.extractionState,
    extractionCoverage: row.extractionCoverage,
    exactNameMatch: false,
    ftsRank: null,
    bestChunkText: null,
    bestChunkAnchor: null,
    metadataMatch: false,
    fusedScore: 0,
  };
}

export interface CandidateRetrievalResult {
  candidates: FileCandidate[];
  /** True when any strategy hit its budget, so more may match. */
  truncated: boolean;
  /** Per-strategy counts, so recall can be measured rather than assumed. */
  recall: {
    exactName: number;
    fullText: number;
    metadata: number;
    browse: number;
  };
}

/**
 * Gather and fuse candidates. With no query this is an ordinary filtered
 * listing; with a query it is exact-name, full-text and metadata retrieval
 * fused by reciprocal rank, with the exact-name bucket kept on top.
 */
export async function retrieveFileCandidates(input: {
  workspaceId: string;
  actor: FileActor;
  query: string | null;
  filters: FileSearchFilters;
  sortBy: FileSortBy;
  sortOrder: FileSortOrder;
}): Promise<CandidateRetrievalResult> {
  const authorized = buildAuthorizedResourceSql({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });
  const filters = buildFiltersSql(input.filters);
  const normalizedQuery = input.query
    ? normalizeFileResourceName(input.query)
    : "";

  if (normalizedQuery.length === 0) {
    const browseOrder =
      input.sortBy === "name"
        ? input.sortOrder === "asc"
          ? PrismaRaw.sql`fr."normalizedName" ASC, fr.id ASC`
          : PrismaRaw.sql`fr."normalizedName" DESC, fr.id DESC`
        : input.sortOrder === "asc"
          ? PrismaRaw.sql`fr."updatedAt" ASC, fr.id ASC`
          : PrismaRaw.sql`fr."updatedAt" DESC, fr.id DESC`;

    const rows = await prisma.$queryRaw<RawResourceRow[]>(PrismaRaw.sql`
      SELECT ${RESOURCE_COLUMNS}
      FROM file_resource fr
      ${CURRENT_VERSION_JOIN}
      WHERE ${authorized} AND ${filters}
      ORDER BY ${browseOrder}
      LIMIT ${RESULT_WINDOW_LIMIT + 1}
    `);

    const truncated = rows.length > RESULT_WINDOW_LIMIT;
    const page = rows.slice(0, RESULT_WINDOW_LIMIT).map(toCandidate);
    return {
      candidates: page,
      truncated,
      recall: {
        exactName: 0,
        fullText: 0,
        metadata: 0,
        browse: page.length,
      },
    };
  }

  const likePrefix = `${escapeLike(normalizedQuery)}%`;
  const likeAnywhere = `%${escapeLike(normalizedQuery)}%`;

  const nameRows = await prisma.$queryRaw<
    (RawResourceRow & { exact: boolean })[]
  >(PrismaRaw.sql`
    SELECT ${RESOURCE_COLUMNS},
      (fr."normalizedName" = ${normalizedQuery}) AS exact
    FROM file_resource fr
    ${CURRENT_VERSION_JOIN}
    WHERE ${authorized} AND ${filters}
      AND (
        fr."normalizedName" = ${normalizedQuery}
        OR fr."normalizedName" LIKE ${likePrefix} ESCAPE '\\'
        OR fr."normalizedName" LIKE ${likeAnywhere} ESCAPE '\\'
      )
    ORDER BY (fr."normalizedName" = ${normalizedQuery}) DESC,
             length(fr."normalizedName") ASC,
             fr."updatedAt" DESC
    LIMIT ${CANDIDATE_BUDGET_EXACT_NAME}
  `);

  const ftsRows = await prisma.$queryRaw<
    (RawResourceRow & {
      rank: number;
      chunkText: string | null;
      chunkAnchor: unknown;
    })[]
  >(PrismaRaw.sql`
    WITH q AS (SELECT websearch_to_tsquery('simple', ${normalizedQuery}) AS tsq),
    hits AS (
      SELECT
        fr.id AS resource_id,
        fc.id AS chunk_id,
        fc.text AS chunk_text,
        fc.anchor AS chunk_anchor,
        ts_rank(fc.search_vector, q.tsq) AS rank,
        ROW_NUMBER() OVER (
          PARTITION BY fr.id ORDER BY ts_rank(fc.search_vector, q.tsq) DESC, fc.ordinal ASC
        ) AS chunk_rank
      FROM file_resource fr
      JOIN file_version fv
        ON fv."resourceId" = fr.id AND fv.revision = fr."contentRevision"
      JOIN file_chunk fc ON fc."versionId" = fv.id
      JOIN file_evidence_scope fes
        ON fes.id = fc."evidenceScopeId" AND fes."scopeVersion" = fc."scopeVersion"
      CROSS JOIN q
      WHERE ${authorized} AND ${filters}
        AND fc.search_vector @@ q.tsq
      LIMIT ${CANDIDATE_BUDGET_FTS_CHUNKS}
    )
    SELECT ${RESOURCE_COLUMNS},
      hits.rank AS "rank",
      hits.chunk_text AS "chunkText",
      hits.chunk_anchor AS "chunkAnchor"
    FROM hits
    JOIN file_resource fr ON fr.id = hits.resource_id
    ${CURRENT_VERSION_JOIN}
    WHERE hits.chunk_rank = 1
    ORDER BY hits.rank DESC
  `);

  const metadataRows = await prisma.$queryRaw<RawResourceRow[]>(PrismaRaw.sql`
    SELECT DISTINCT ${RESOURCE_COLUMNS}
    FROM file_resource fr
    ${CURRENT_VERSION_JOIN}
    WHERE ${authorized} AND ${filters}
      AND (
        EXISTS (
          SELECT 1 FROM file_label fl
          JOIN workspace_label wl ON wl.id = fl."labelId"
          WHERE fl."resourceId" = fr.id
            AND fl.state = ${FileMetadataState.CONFIRMED}::"FileMetadataState"
            AND wl."normalizedName" LIKE ${likeAnywhere} ESCAPE '\\'
        )
        OR EXISTS (
          SELECT 1 FROM file_project_link fpl
          JOIN project p ON p.id = fpl."projectId"
          WHERE fpl."resourceId" = fr.id
            AND fpl.state = ${FileMetadataState.CONFIRMED}::"FileMetadataState"
            AND lower(p.name) LIKE ${likeAnywhere} ESCAPE '\\'
        )
      )
    ORDER BY fr."updatedAt" DESC
    LIMIT ${CANDIDATE_BUDGET_METADATA}
  `);

  const byId = new Map<string, FileCandidate>();

  const upsert = (row: RawResourceRow): FileCandidate => {
    const existing = byId.get(row.id);
    if (existing) return existing;
    const candidate = toCandidate(row);
    byId.set(row.id, candidate);
    return candidate;
  };

  nameRows.forEach((row, index) => {
    const candidate = upsert(row);
    candidate.exactNameMatch = candidate.exactNameMatch || row.exact === true;
    candidate.fusedScore += 1 / (RRF_K + index + 1);
  });

  ftsRows.forEach((row, index) => {
    const candidate = upsert(row);
    candidate.ftsRank = row.rank;
    candidate.bestChunkText = row.chunkText;
    candidate.bestChunkAnchor = row.chunkAnchor;
    candidate.fusedScore += 1 / (RRF_K + index + 1);
  });

  metadataRows.forEach((row, index) => {
    const candidate = upsert(row);
    candidate.metadataMatch = true;
    candidate.fusedScore += 1 / (RRF_K + index + 1);
  });

  const fused = orderFusedCandidates([...byId.values()], input);

  return {
    candidates: fused.slice(0, RESULT_WINDOW_LIMIT),
    truncated:
      fused.length > RESULT_WINDOW_LIMIT ||
      nameRows.length >= CANDIDATE_BUDGET_EXACT_NAME ||
      ftsRows.length >= CANDIDATE_BUDGET_FTS_CHUNKS ||
      metadataRows.length >= CANDIDATE_BUDGET_METADATA,
    recall: {
      exactName: nameRows.length,
      fullText: ftsRows.length,
      metadata: metadataRows.length,
      browse: 0,
    },
  };
}

/**
 * Exact filename matches lead, always. Below them, an explicit sort stays
 * deterministic and is never silently reranked; relevance uses the fused
 * score with a stable id tie-break so two equal scores keep one order.
 */
export function orderFusedCandidates(
  candidates: FileCandidate[],
  input: { sortBy: FileSortBy; sortOrder: FileSortOrder },
): FileCandidate[] {
  const direction = input.sortOrder === "asc" ? 1 : -1;

  return [...candidates].sort((left, right) => {
    if (left.exactNameMatch !== right.exactNameMatch) {
      return left.exactNameMatch ? -1 : 1;
    }

    if (input.sortBy === "name") {
      const byName = left.normalizedName.localeCompare(right.normalizedName);
      if (byName !== 0) return byName * direction;
    } else if (input.sortBy === "modified") {
      const byTime = left.updatedAt.getTime() - right.updatedAt.getTime();
      if (byTime !== 0) return byTime * direction;
    } else {
      if (left.fusedScore !== right.fusedScore) {
        return right.fusedScore - left.fusedScore;
      }
      const byTime = right.updatedAt.getTime() - left.updatedAt.getTime();
      if (byTime !== 0) return byTime;
    }

    return left.resourceId.localeCompare(right.resourceId);
  });
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`);
}
