import {
  FileExtractionState,
  FileIndexJobPipeline,
  FileSourceKind,
  FileSourceScope,
  type Prisma,
} from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { head } from "@vercel/blob";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { ensureEvidenceScope } from "@/lib/files/evidence-scope";
import type { ExtractedChunk } from "@/lib/files/extraction";
import {
  extractDocument,
  FILE_EXTRACTION_MAX_BYTES,
} from "@/lib/files/extraction";
import {
  canActivateFileIndexAttempt,
  completeFileIndexJob,
  enqueueFileIndexJob,
  failFileIndexJob,
  type LeasedFileIndexJob,
  leaseNextFileIndexJob,
  registerFileIndexArtifact,
} from "@/lib/files/index-jobs";

/**
 * The indexer: fetch, extract, and swap a version's passages in under a
 * fence.
 *
 * Nothing is written until the attempt has registered its namespace, and
 * nothing is activated unless the lease, the fence, the content revision and
 * the absence of a tombstone all still hold. A worker that was paused and
 * resumed after a delete writes nothing.
 */

const DOWNLOAD_TIMEOUT_MS = 20_000;

/**
 * Replace a version's chunks in one statement per chunk, filling the
 * `tsvector` in the same insert. The column is not generated, so this is the
 * one place that writes it — see the note on `FileChunk.searchVector`.
 */
export async function writeVersionChunks(input: {
  versionId: string;
  evidenceScopeId: string;
  scopeVersion: number;
  chunks: ExtractedChunk[];
  client?: Prisma.TransactionClient;
}): Promise<void> {
  const client = input.client ?? prisma;

  await client.fileChunk.deleteMany({ where: { versionId: input.versionId } });

  for (const chunk of input.chunks) {
    await client.$executeRaw(PrismaRaw.sql`
      INSERT INTO file_chunk (
        id, "createdAt", "versionId", "chunkId", ordinal, anchor, text,
        "evidenceScopeId", "scopeVersion", "inputDigest", search_vector
      ) VALUES (
        gen_random_uuid(), now(), ${input.versionId}::uuid, ${chunk.chunkId},
        ${chunk.ordinal}, ${JSON.stringify(chunk.anchor)}::jsonb, ${chunk.text},
        ${input.evidenceScopeId}::uuid, ${input.scopeVersion},
        ${chunk.inputDigest}, to_tsvector('simple', ${chunk.text})
      )
    `);
  }
}

async function downloadBlob(objectKey: string): Promise<Uint8Array | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const metadata = await head(objectKey, { token });
  if (metadata.size > FILE_EXTRACTION_MAX_BYTES) return null;

  const response = await fetch(metadata.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) return null;

  return new Uint8Array(await response.arrayBuffer());
}

export interface ExtractionRunOutcome {
  state: FileExtractionState;
  chunkCount: number;
  activated: boolean;
}

/**
 * Run one extraction attempt end to end. Returns what happened so the sync
 * loop can log a count without knowing anything about extraction.
 */
export async function runExtractionJob(
  leased: LeasedFileIndexJob,
): Promise<ExtractionRunOutcome> {
  const { job, leaseOwner } = leased;

  const resource = await prisma.fileResource.findUnique({
    where: { id: job.resourceId },
    select: {
      id: true,
      workspaceId: true,
      displayName: true,
      mimeType: true,
      sourceKind: true,
      sourceScope: true,
      ownerUserId: true,
      ownerOrganizationId: true,
      contentRevision: true,
      tombstonedAt: true,
      versions: {
        where: { revision: job.contentRevision },
        select: { id: true, objectKey: true, mimeType: true },
      },
    },
  });

  if (!resource || resource.tombstonedAt || resource.versions.length === 0) {
    await completeFileIndexJob({ jobId: job.id, leaseOwner });
    return {
      state: FileExtractionState.FAILED,
      chunkCount: 0,
      activated: false,
    };
  }

  const version = resource.versions[0];

  // Register the namespace this attempt may write to before any write, so a
  // crash leaves a ledger entry rather than an invisible orphan.
  await registerFileIndexArtifact({
    jobId: job.id,
    attempt: job.attempt,
    fence: job.fence,
    namespace: `chunks:${version.id}`,
    kind: "chunks",
  });

  let bytes: Uint8Array | null = null;
  try {
    bytes = await downloadBlob(version.objectKey);
  } catch (error) {
    await failFileIndexJob({
      jobId: job.id,
      leaseOwner,
      attempt: job.attempt,
      error: error instanceof Error ? error.message : "download failed",
    });
    return {
      state: FileExtractionState.FAILED,
      chunkCount: 0,
      activated: false,
    };
  }

  const extraction = bytes
    ? extractDocument({
        bytes,
        mimeType: version.mimeType ?? resource.mimeType,
        displayName: resource.displayName,
      })
    : {
        state: FileExtractionState.PARTIAL,
        coverage: 0,
        reason: "The file could not be read for indexing.",
        chunks: [] as ExtractedChunk[],
        extractorVersion: "files-extractor-v1",
      };

  const canActivate = await canActivateFileIndexAttempt({
    jobId: job.id,
    leaseOwner,
    fence: job.fence,
    contentRevision: job.contentRevision,
  });

  if (!canActivate) {
    // Fenced: the world moved on. Nothing is written, and the artifact the
    // attempt reserved is marked abandoned for the sweeper.
    await prisma.fileIndexArtifact.updateMany({
      where: { jobId: job.id, attempt: job.attempt },
      data: { state: "ABANDONED" },
    });
    await failFileIndexJob({
      jobId: job.id,
      leaseOwner,
      attempt: job.attempt,
      error: "fenced before activation",
    });
    return { state: extraction.state, chunkCount: 0, activated: false };
  }

  const scope = await ensureEvidenceScope({
    workspaceId: resource.workspaceId,
    sourceKind: resource.sourceKind,
    sourceScope: resource.sourceScope,
    sourceId: evidenceSourceIdFor(resource),
  });

  await prisma.$transaction(async (tx) => {
    await writeVersionChunks({
      versionId: version.id,
      evidenceScopeId: scope.id,
      scopeVersion: scope.scopeVersion,
      chunks: extraction.chunks,
      client: tx,
    });
    await tx.fileVersion.update({
      where: { id: version.id },
      data: {
        extractionState: extraction.state,
        extractionCoverage: extraction.coverage,
        extractionReason: extraction.reason,
        extractorVersion: extraction.extractorVersion,
        textRevision: { increment: 1 },
      },
    });
    await tx.fileIndexArtifact.updateMany({
      where: { jobId: job.id, attempt: job.attempt },
      data: { state: "ACTIVE" },
    });
  });

  await completeFileIndexJob({ jobId: job.id, leaseOwner });

  // Suggestions are separate work: a document is searchable as soon as its
  // text lands, whether or not anything has an opinion about its category.
  if (extraction.chunks.length > 0) {
    await enqueueFileIndexJob({
      resourceId: resource.id,
      pipeline: FileIndexJobPipeline.SUGGEST,
      contentRevision: job.contentRevision,
    });
  }

  return {
    state: extraction.state,
    chunkCount: extraction.chunks.length,
    activated: true,
  };
}

function evidenceSourceIdFor(resource: {
  sourceKind: FileSourceKind;
  sourceScope: FileSourceScope;
  ownerUserId: string | null;
  ownerOrganizationId: string | null;
}): string {
  if (resource.sourceKind === FileSourceKind.DRIVE_UPLOAD) {
    return resource.sourceScope === FileSourceScope.USER
      ? (resource.ownerUserId ?? "")
      : (resource.ownerOrganizationId ?? "");
  }
  return resource.ownerUserId ?? resource.ownerOrganizationId ?? "";
}

export interface FileIndexSyncResult {
  processed: number;
  indexed: number;
  failed: number;
}

/**
 * Drain runnable index jobs until the caller says stop. Used by the cron and,
 * because Vercel does not run crons on preview deployments, by the
 * in-process nudge after an upload.
 */
export async function processFileIndexJobs(input: {
  shouldContinue: () => boolean;
  maxJobs?: number;
}): Promise<FileIndexSyncResult> {
  const maxJobs = input.maxJobs ?? 25;
  const result: FileIndexSyncResult = { processed: 0, indexed: 0, failed: 0 };

  while (result.processed < maxJobs && input.shouldContinue()) {
    const leased = await leaseNextFileIndexJob({
      pipeline: FileIndexJobPipeline.EXTRACT,
    });
    if (!leased) break;

    result.processed += 1;
    try {
      const outcome = await runExtractionJob(leased);
      if (outcome.activated) result.indexed += 1;
      else result.failed += 1;
    } catch (error) {
      result.failed += 1;
      await failFileIndexJob({
        jobId: leased.job.id,
        leaseOwner: leased.leaseOwner,
        attempt: leased.job.attempt,
        error: error instanceof Error ? error.message : "extraction failed",
      });
    }
  }

  return result;
}
