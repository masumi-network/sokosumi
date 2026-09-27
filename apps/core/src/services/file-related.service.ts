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
  const candidates = await prisma.$queryRaw<{ id: string; rank: number }[]>(
    PrismaRaw.sql`
      WITH q AS (
        SELECT plainto_tsquery('simple', ${seedText.slice(0, 2_000)}) AS tsq
      )
      SELECT fr.id, MAX(ts_rank(fc.search_vector, q.tsq)) AS rank
      FROM file_resource fr
      JOIN file_version fv
        ON fv."resourceId" = fr.id AND fv.revision = fr."contentRevision"
      JOIN file_chunk fc ON fc."versionId" = fv.id
      CROSS JOIN q
      WHERE ${authorized}
        AND fr.id <> ${seed.id}::uuid
        AND (fr."lineageId" IS NULL OR fr."lineageId" IS DISTINCT FROM (
          SELECT seed."lineageId" FROM file_resource seed WHERE seed.id = ${seed.id}::uuid
        ))
        AND fc.search_vector @@ q.tsq
      GROUP BY fr.id
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
