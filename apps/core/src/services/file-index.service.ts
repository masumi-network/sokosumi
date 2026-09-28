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
  extractDocumentAsync,
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
import { PDF_TIMEOUT_MS } from "@/lib/files/pdf";

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
 * The metadata lookup that precedes the download.
 *
 * It had no timeout at all, which made this job's worst case unknowable
 * and therefore un-budgetable. The drain loop below now refuses to lease a
 * job it cannot finish inside the sync window, and that refusal is only
 * meaningful if there is a number to compare against. Ten seconds is
 * generous for a HEAD against blob storage and small enough to keep the
 * total inside the budget.
 */
const HEAD_TIMEOUT_MS = 10_000;

/**
 * What one extraction job can cost, in the worst case, end to end.
 *
 * `HEAD_TIMEOUT_MS` + `DOWNLOAD_TIMEOUT_MS` + `PDF_TIMEOUT_MS` + the write
 * transaction. Each of the first three is a real ceiling enforced by an
 * abort signal; ten seconds is allowed for the chunk write, which is many
 * statements but all local.
 *
 * This number exists because the drain loop checked `shouldContinue()`
 * before leasing and never during, so a job leased with 0.1 s left ran to
 * completion regardless. At the documented production window — a
 * `LOCK_TIMEOUT` of 120,000 minus a `LOCK_TIMEOUT_BUFFER` of 25,000, so
 * 95 s — a job leased at 94.9 s finished around 135 s, which is 15 s past
 * `LOCK_TIMEOUT`, at which point the lock becomes stealable and the next
 * minute's tick runs the same pipeline concurrently. The lease and fence
 * make that wasted work rather than corruption, but it is a tick spent
 * racing itself. ADR 0039's "worst-case gap of about 25 s" was written
 * before a twenty-second-per-item parser lived inside this loop.
 */
export const EXTRACTION_JOB_WORST_CASE_MS =
  HEAD_TIMEOUT_MS + DOWNLOAD_TIMEOUT_MS + PDF_TIMEOUT_MS + 10_000;

/**
 * Held back from extraction for everything that runs after it.
 *
 * Extraction runs first in `drive-index`, and before this it could use the
 * entire window: a handful of slow PDFs starved suggestion, table
 * re-indexing and admission pruning for that whole tick, every minute,
 * with nothing saying so.
 *
 * Twenty seconds because the three stages behind it are all bounded
 * database work — no provider call is made by the tick itself — and
 * because the window is not large enough to be generous. At 95 s, holding
 * back 20 s and reserving 60 s for a job in flight leaves a 15 s leasing
 * window. That is hundreds of ordinary text documents, or exactly one
 * worst-case PDF.
 *
 * The cost is real and worth stating: a backlog of slow PDFs drains at
 * roughly one per tick. Uploads do not wait on it — `nudgeFileIndexing`
 * extracts in the request that created the work — so this affects
 * catch-up, not the path a person is watching.
 */
export const SYNC_TAIL_RESERVE_MS = 20_000;

/**
 * Enough budget left to start a job that might take the worst case?
 *
 * Conservative on purpose: nothing here can tell a five-millisecond text
 * file from a twenty-second PDF before leasing it, so the reserve has to
 * assume the expensive one.
 */
function hasBudgetToLease(msRemaining: (() => number) | undefined): boolean {
  if (!msRemaining) return true;
  return msRemaining() >= EXTRACTION_JOB_WORST_CASE_MS + SYNC_TAIL_RESERVE_MS;
}

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

/**
 * Exported for one test, and the test is the reason the export is worth
 * it: every call in here has to be bounded, or
 * `EXTRACTION_JOB_WORST_CASE_MS` is a number with nothing behind it and
 * the lease budget built on it is a fiction. The `head` call had no
 * timeout and nothing noticed.
 */
export async function downloadBlob(
  objectKey: string,
): Promise<Uint8Array | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const metadata = await head(objectKey, {
    token,
    abortSignal: AbortSignal.timeout(HEAD_TIMEOUT_MS),
  });
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
    ? await extractDocumentAsync({
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
      /**
       * Carried from the extraction job, not defaulted.
       *
       * Without this a retry died halfway. `requeueFileIndexJob` mints a
       * new generation so the EXTRACT job has a fresh identity, but this
       * enqueue passed none and so asked for generation 1 — the key the
       * original SUGGEST already holds at SUCCEEDED, which the upsert
       * matches and leaves untouched. The document would be re-extracted
       * and never re-labelled, which is most of what "the labels came
       * out wrong" means.
       */
      desiredGeneration: job.desiredGeneration,
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
  /**
   * Budget left in the sync window. Optional because the in-process nudge
   * bounds itself with its own clock and has no lock to overrun; when it
   * is absent the worst-case reserve is not applied.
   */
  msRemaining?: () => number;
}): Promise<FileIndexSyncResult> {
  const maxJobs = input.maxJobs ?? 25;
  const result: FileIndexSyncResult = { processed: 0, indexed: 0, failed: 0 };

  while (result.processed < maxJobs && input.shouldContinue()) {
    if (!hasBudgetToLease(input.msRemaining)) {
      // Deliberately before the lease, not after. A job leased here would
      // run past the lock's expiry and let the next tick start the same
      // pipeline beside it.
      console.info(
        "[files] extraction stopped early to stay inside the sync window",
        {
          processed: result.processed,
          msRemaining: input.msRemaining?.() ?? null,
          reserveMs: EXTRACTION_JOB_WORST_CASE_MS + SYNC_TAIL_RESERVE_MS,
        },
      );
      break;
    }

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
