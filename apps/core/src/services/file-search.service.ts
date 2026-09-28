import {
  type FileExtractionState,
  FileLabelKind,
  FileMetadataState,
  FileResultWindowKind,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { normalizeFileResourceName } from "@sokosumi/utils";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import type { FileActor } from "@/lib/files/actor";
import {
  buildAuthorizedResourceSql,
  resolveScopeEpoch,
} from "@/lib/files/evidence-scope";
import {
  publicRankingFallback,
  type RankingFallback,
  rerankFileCandidates,
} from "@/lib/files/jev-ranking";
import type {
  FileCandidate,
  FileSearchFilters,
  FileSortBy,
  FileSortOrder,
} from "@/lib/files/retrieval";
import {
  RESULT_WINDOW_LIMIT,
  retrieveFileCandidates,
} from "@/lib/files/retrieval";
import {
  buildSearchBindingDigest,
  createResultWindow,
  decodeSearchCursor,
  encodeSearchCursor,
  loadResultWindow,
  SEARCH_PAGE_MAX,
  takeWindowPage,
  type WindowEntry,
} from "@/lib/files/search-session";
import { buildFileSnippet } from "@/lib/files/snippet";
import type {
  FileResourceDto,
  FileSearchMetaDto,
} from "@/schemas/file-resource.schema";

/**
 * One search, from authorized retrieval to a page of DTOs.
 *
 * The order is taken once into a snapshot and paged by position. A cursor
 * that no longer applies — different actor, different query, different
 * authorization clocks — restarts with a fresh window and says so, rather
 * than paging through an order built under conditions that have changed.
 */

export interface FileSearchInput {
  workspaceId: string;
  actor: FileActor;
  query: string | null;
  filters: FileSearchFilters;
  sortBy: FileSortBy;
  sortOrder: FileSortOrder;
  cursor: string | null;
  limit: number;
}

export interface FileSearchResult {
  items: FileResourceDto[];
  search: FileSearchMetaDto;
}

const INDEX_GENERATION = 1;

export async function searchFiles(
  input: FileSearchInput,
): Promise<FileSearchResult> {
  const secret = getEnv().BETTER_AUTH_SECRET;
  const bindingDigest = buildSearchBindingDigest({
    query: input.query,
    filters: input.filters,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    indexGeneration: INDEX_GENERATION,
  });
  const epochVector = await resolveScopeEpoch({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });

  let windowId: string | null = null;
  let entries: WindowEntry[] = [];
  let truncated = false;
  let position = 0;
  let restarted = false;
  let rankingMode: "deterministic" | "model" = "deterministic";
  /**
   * Null until a ranking is actually attempted, which is not the same as
   * "the model applied". A cursor page reuses a stored window and ranks
   * nothing, so it reports null rather than inventing a cause.
   */
  let rankingFallback: RankingFallback | null = null;

  if (input.cursor) {
    const payload = decodeSearchCursor(input.cursor, secret);
    const loaded = await loadResultWindow({
      windowId: payload.w,
      workspaceId: input.workspaceId,
      actor: input.actor,
      bindingDigest,
      epochVector,
    });

    if ("window" in loaded) {
      windowId = loaded.window.id;
      entries = loaded.window.entries;
      truncated = loaded.window.truncated;
      position = payload.p;
      /**
       * As recorded with the order, not as re-derived.
       *
       * Both pages serve positions out of one stored order. This branch
       * ranks nothing, so it used to leave the initialiser alone and page
       * two reported "deterministic" for a window the model had ordered.
       * The same twenty documents, the same order, and two different
       * accounts of how they got there.
       *
       * `rankingFallback` stays null here on purpose: it describes an
       * attempt, and this page attempts no ranking.
       */
      rankingMode = loaded.window.rankingMode;
    } else {
      restarted = true;
    }
  }

  if (!windowId) {
    const retrieval = await retrieveFileCandidates({
      workspaceId: input.workspaceId,
      actor: input.actor,
      query: input.query,
      filters: input.filters,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    });

    let ordered: FileCandidate[] = retrieval.candidates;

    // An explicit date or name sort is deterministic and is never reranked.
    if (input.query && input.sortBy === "relevance") {
      const ranking = await rerankFileCandidates({
        workspaceId: input.workspaceId,
        actor: input.actor,
        epoch: epochVector,
        query: input.query,
        candidates: retrieval.candidates,
      });
      ordered = ranking.candidates;
      rankingMode = ranking.mode;
      rankingFallback = publicRankingFallback(ranking.fallbackReason);
    }

    entries = ordered.slice(0, RESULT_WINDOW_LIMIT).map((candidate) => ({
      r: candidate.resourceId,
      c: candidate.contentRevision,
      m: candidate.metadataRevision,
      k: candidate.bestChunkId,
    }));
    truncated = retrieval.truncated;

    const created = await createResultWindow({
      workspaceId: input.workspaceId,
      actor: input.actor,
      kind: FileResultWindowKind.SEARCH,
      bindingDigest,
      epochVector,
      entries,
      truncated,
      // Stored with the order it describes, so every later page of this
      // window reports the same thing this page does.
      rankingMode,
    });
    windowId = created.id;
    position = 0;
  }

  /**
   * Fill the page, fetching more of the window when entries drop out.
   *
   * One prefetch of `limit + 20` was not enough. Once more than 20 of the
   * scanned entries had genuinely moved, the walk ran past what had been
   * fetched and treated every further entry as missing — dropping live
   * files, and advancing the cursor past them so they never returned. Now
   * the walk is bounded by what we actually looked up, and we look up more
   * until the page is full or the window ends.
   */
  const pageLimit = Math.min(input.limit, SEARCH_PAGE_MAX);
  const byId = new Map<string, LiveResource>();
  const current = new Map<
    string,
    { contentRevision: number; metadataRevision: number }
  >();
  const collected: string[] = [];
  let cursorPosition = position;
  let omitted = 0;
  let scanned = 0;

  // Bounded so a window of tombstones cannot turn one request into an
  // unbounded scan; the page simply comes back short and `hasMore` is true.
  const MAX_FETCH_ROUNDS = 5;

  for (let round = 0; round < MAX_FETCH_ROUNDS; round += 1) {
    if (collected.length >= pageLimit) break;
    if (cursorPosition >= entries.length) break;

    const slice = entries.slice(
      cursorPosition,
      cursorPosition + (pageLimit - collected.length) + 20,
    );
    const batch = slice.map((entry) => entry.r);
    const batchChunks = slice.map((entry) => entry.k ?? null);
    if (batch.length === 0) break;

    const live = await loadLiveResources({
      workspaceId: input.workspaceId,
      actor: input.actor,
      resourceIds: batch,
      chunkIds: batchChunks,
    });
    for (const resource of live) {
      byId.set(resource.id, resource);
      current.set(resource.id, {
        contentRevision: resource.contentRevision,
        metadataRevision: resource.metadataRevision,
      });
    }

    const round_page = takeWindowPage({
      entries,
      from: cursorPosition,
      limit: pageLimit - collected.length,
      current,
      available: batch.length,
    });

    collected.push(...round_page.resourceIds);
    omitted += round_page.omitted;
    scanned += round_page.scanned;
    cursorPosition = round_page.nextPosition;
  }

  const page = {
    resourceIds: collected,
    nextPosition: cursorPosition,
    hasMore: cursorPosition < entries.length,
    scanned,
    omitted,
  };
  const items = await hydrateResources({
    resources: page.resourceIds
      .map((id) => byId.get(id))
      .filter((resource): resource is LiveResource => Boolean(resource)),
    query: input.query,
  });

  const remaining = Math.max(0, entries.length - page.nextPosition);

  return {
    items,
    search: {
      rankingMode,
      rankingFallback,
      resultWindowLimit: RESULT_WINDOW_LIMIT,
      windowCount: entries.length,
      remainingWindowCount: remaining,
      truncated,
      /**
       * False here and set by the route.
       *
       * The search itself has no opinion: adoption of pre-existing blobs
       * is a read-path convenience the route owns, and it is the route
       * that knows whether it failed. Defaulted rather than optional so
       * every response carries the field and a caller never has to tell
       * "not degraded" apart from "nobody said".
       */
      catalogIncomplete: false,
      hasMore: page.hasMore,
      nextCursor: page.hasMore
        ? encodeSearchCursor(
            { v: 1, w: windowId, p: page.nextPosition },
            secret,
          )
        : null,
      restarted,
      indexCoverage: coverageOf(items),
    },
  };
}

function coverageOf(items: FileResourceDto[]): {
  indexed: number;
  processing: number;
  filenameOnly: number;
} {
  let indexed = 0;
  let processing = 0;
  let filenameOnly = 0;

  for (const item of items) {
    switch (item.extractionState) {
      case "INDEXED":
        indexed += 1;
        break;
      case "PENDING":
      case "RUNNING":
        processing += 1;
        break;
      default:
        filenameOnly += 1;
    }
  }

  return { indexed, processing, filenameOnly };
}

export interface LiveResource {
  id: string;
  displayName: string;
  normalizedName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  sourceKind: FileResourceDto["sourceKind"];
  sourceTaskId: string | null;
  sourceProjectId: string | null;
  updatedAt: Date;
  contentRevision: number;
  metadataRevision: number;
  extractionState: FileExtractionState | null;
  extractionCoverage: number | null;
  extractionReason: string | null;
  bestChunkText: string | null;
}

/**
 * Re-read the scanned entries through the authorization predicate. A cache
 * hit is never authorization: this runs before anything is hydrated, on
 * every page.
 */
export async function loadLiveResources(input: {
  workspaceId: string;
  actor: FileActor;
  resourceIds: string[];
  /**
   * The chunk that matched, per resource, aligned with `resourceIds`.
   *
   * Without it the snippet under every result is the document's opening,
   * whatever the reader searched for: the query below took
   * `ORDER BY fc.ordinal ASC LIMIT 1`, which is the first chunk, always.
   * Optional and null-tolerant, because the browse, metadata and
   * exact-name legs match a document rather than a passage, and because
   * result windows written before this existed carry no chunk id.
   */
  chunkIds?: (string | null | undefined)[];
  query?: string | null;
}): Promise<LiveResource[]> {
  if (input.resourceIds.length === 0) return [];

  const wantedChunks = input.resourceIds.map(
    (_, index) => input.chunkIds?.[index] ?? null,
  );

  const authorized = buildAuthorizedResourceSql({
    workspaceId: input.workspaceId,
    actor: input.actor,
  });

  return prisma.$queryRaw<LiveResource[]>(PrismaRaw.sql`
    SELECT
      fr.id,
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
      fv."extractionCoverage",
      fv."extractionReason",
      (
        -- The chunk that matched, when one was named; otherwise the
        -- document's opening, which is what this always returned.
        SELECT fc.text FROM file_chunk fc
        WHERE fc."versionId" = fv.id
        ORDER BY (fc.id::text = wanted.chunk_id) DESC NULLS LAST,
                 fc.ordinal ASC
        LIMIT 1
      ) AS "bestChunkText"
    FROM unnest(
      ${input.resourceIds}::text[],
      ${wantedChunks}::text[]
    ) AS wanted(resource_id, chunk_id)
    JOIN file_resource fr ON fr.id::text = wanted.resource_id
    LEFT JOIN file_version fv
      ON fv."resourceId" = fr.id AND fv.revision = fr."contentRevision"
    WHERE ${authorized}
  `);
}

/**
 * Attach the metadata for resources this reader has already been authorized
 * to see. Confirmed labels order and filter; suggestions are shown as
 * suggestions, with the extracted span that justifies them.
 *
 * "In-scope" used to appear in this sentence. These queries filter on
 * `resourceId` and `state`, with no scope predicate, so it was not true —
 * what makes the result safe is that `loadLiveResources` re-checked every
 * one of these resources through the authorization predicate first.
 */
export async function hydrateResources(input: {
  resources: LiveResource[];
  query: string | null;
}): Promise<FileResourceDto[]> {
  if (input.resources.length === 0) return [];

  const ids = input.resources.map((resource) => resource.id);

  const [labels, links] = await Promise.all([
    prisma.fileLabel.findMany({
      where: {
        resourceId: { in: ids },
        state: { not: FileMetadataState.REJECTED },
      },
      select: {
        id: true,
        resourceId: true,
        labelId: true,
        state: true,
        provenance: true,
        evidenceSnippet: true,
        contentRevision: true,
        vocabularyVersion: true,
        label: {
          select: {
            kind: true,
            displayName: true,
            vocabularyVersion: true,
            archivedAt: true,
          },
        },
      },
    }),
    prisma.fileProjectLink.findMany({
      where: {
        resourceId: { in: ids },
        state: { not: FileMetadataState.REJECTED },
      },
      select: {
        id: true,
        resourceId: true,
        projectId: true,
        state: true,
        provenance: true,
        evidenceSnippet: true,
        project: { select: { name: true } },
      },
    }),
  ]);

  const labelsByResource = new Map<string, typeof labels>();
  for (const label of labels) {
    const bucket = labelsByResource.get(label.resourceId) ?? [];
    bucket.push(label);
    labelsByResource.set(label.resourceId, bucket);
  }

  const linksByResource = new Map<string, typeof links>();
  for (const link of links) {
    const bucket = linksByResource.get(link.resourceId) ?? [];
    bucket.push(link);
    linksByResource.set(link.resourceId, bucket);
  }

  return input.resources.map((resource) => {
    const resourceLabels = labelsByResource.get(resource.id) ?? [];

    const toDto = (label: (typeof labels)[number]) => ({
      id: label.id,
      labelId: label.labelId,
      kind: label.label.kind,
      displayName: label.label.displayName,
      state: label.state,
      provenance: label.provenance,
      evidenceSnippet: label.evidenceSnippet,
      // A suggestion computed against older content or an older vocabulary
      // is stale: it is still shown, but never as a current fact.
      stale:
        label.state === FileMetadataState.SUGGESTED &&
        (label.contentRevision !== resource.contentRevision ||
          label.vocabularyVersion !== label.label.vocabularyVersion),
    });

    const confirmed = resourceLabels.filter(
      (label) => label.state === FileMetadataState.CONFIRMED,
    );

    const snippet = resource.bestChunkText
      ? buildFileSnippet({ text: resource.bestChunkText, query: input.query })
      : null;

    return {
      id: resource.id,
      displayName: resource.displayName,
      mimeType: resource.mimeType,
      sizeBytes:
        resource.sizeBytes === null ? null : Number(resource.sizeBytes),
      sourceKind: resource.sourceKind,
      sourceTaskId: resource.sourceTaskId,
      sourceProjectId: resource.sourceProjectId,
      updatedAt: resource.updatedAt.toISOString(),
      contentRevision: resource.contentRevision,
      metadataRevision: resource.metadataRevision,
      extractionState: resource.extractionState,
      extractionCoverage: resource.extractionCoverage,
      extractionReason: resource.extractionReason,
      category:
        confirmed
          .filter((label) => label.label.kind === FileLabelKind.CATEGORY)
          .map(toDto)[0] ?? null,
      tags: confirmed
        .filter((label) => label.label.kind === FileLabelKind.TAG)
        .map(toDto),
      suggestions: resourceLabels
        .filter((label) => label.state === FileMetadataState.SUGGESTED)
        .map(toDto),
      projects: (linksByResource.get(resource.id) ?? []).map((link) => ({
        id: link.id,
        projectId: link.projectId,
        projectName: link.project.name,
        state: link.state,
        provenance: link.provenance,
        evidenceSnippet: link.evidenceSnippet,
      })),
      snippet,
      relatedReason: null,
      filenameMatch:
        input.query !== null &&
        resource.normalizedName === normalizeFileResourceName(input.query),
    } satisfies FileResourceDto;
  });
}
