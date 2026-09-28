import { createHash, randomUUID } from "node:crypto";

import {
  type FileIndexJob,
  FileIndexJobPipeline,
  FileIndexJobState,
  type Prisma,
} from "@sokosumi/database";

import prisma from "@/lib/db/prisma";

/**
 * Background work against one resource revision, fenced so a slow worker
 * cannot activate its output after the world moved on.
 *
 * The dedupe key is the job's identity: the same resource at the same content
 * revision through the same pipeline is one job, however many times it is
 * enqueued. A retry keeps that identity and takes a new attempt and fence.
 */

export const FILE_INDEX_JOB_MAX_ATTEMPTS = 5;
export const FILE_INDEX_JOB_LEASE_MS = 60_000;
const RETRY_BACKOFF_MS = [60_000, 300_000, 1_800_000];

/**
 * How many times a sweep may bring one job back from FAILED.
 *
 * Bounded, and counted separately from `attempt` because a revival resets
 * that. Three revivals half a day apart covers a day and a half of
 * incident and then stops, so a document that fails for its own reasons —
 * a file the parser cannot read, a resource that no longer exists — is
 * retried a few times and then left alone rather than forever.
 */
export const FILE_INDEX_JOB_MAX_REVIVALS = 3;

/**
 * How long a FAILED job waits before a sweep will touch it.
 *
 * Not tuned against the retry backoff, which it obviously has to clear —
 * five attempts span about 36 minutes, and the longest single backoff is
 * 30. Tuned against the *incident*. A sweep that runs while the provider
 * is still down spends the whole revival budget on the same outage and
 * leaves nothing for the recovery, which is the only moment a revival is
 * worth anything. So this is deliberately longer than a plausible
 * provider incident rather than slightly longer than a backoff.
 *
 * The cost of being wrong in this direction is a document labelled half a
 * day late. The cost of being wrong in the other is a document never
 * labelled at all, which is the defect being fixed.
 *
 * Changing this number changes a test. Case 1 of
 * `suggestion-outage-is-terminal.postgres.test.ts` pins the retry budget
 * to an exact dispatch count, and that count holds only while this delay
 * exceeds that fixture's eight-hour outage. A red there is the sweep
 * firing mid-incident, not a stale assertion.
 */
export const FILE_INDEX_JOB_REVIVE_AFTER_MS = 12 * 3_600_000;

/** One sweep moves at most this many rows, so a tick stays bounded. */
const REVIVE_BATCH = 50;

export function fileIndexJobDedupeKey(input: {
  resourceId: string;
  pipeline: FileIndexJobPipeline;
  contentRevision: number;
  requiredScopeVersion: number;
  desiredGeneration: number;
}): string {
  return createHash("sha256")
    .update(input.resourceId)
    .update("\0")
    .update(input.pipeline)
    .update("\0")
    .update(String(input.contentRevision))
    .update("\0")
    .update(String(input.requiredScopeVersion))
    .update("\0")
    .update(String(input.desiredGeneration))
    .digest("base64url");
}

export async function enqueueFileIndexJob(
  input: {
    resourceId: string;
    pipeline: FileIndexJobPipeline;
    contentRevision: number;
    requiredScopeVersion?: number;
    desiredGeneration?: number;
    runAfter?: Date;
  },
  client: Prisma.TransactionClient = prisma,
): Promise<string> {
  const requiredScopeVersion = input.requiredScopeVersion ?? 1;
  const desiredGeneration = input.desiredGeneration ?? 1;
  const dedupeKey = fileIndexJobDedupeKey({
    resourceId: input.resourceId,
    pipeline: input.pipeline,
    contentRevision: input.contentRevision,
    requiredScopeVersion,
    desiredGeneration,
  });

  const job = await client.fileIndexJob.upsert({
    where: { dedupeKey },
    create: {
      resourceId: input.resourceId,
      pipeline: input.pipeline,
      dedupeKey,
      contentRevision: input.contentRevision,
      requiredScopeVersion,
      desiredGeneration,
      runAfter: input.runAfter ?? new Date(),
    },
    /**
     * Nothing. Deliberately, and the comment that used to sit here said
     * the opposite: "re-enqueueing a settled job is an explicit retry:
     * same identity, new attempt". It is not, and SUCCEEDED is settled.
     *
     * An identical key finds the existing row and changes nothing; only
     * the FAILED and CANCELLED branch below moves a row back to QUEUED.
     * A SUCCEEDED job falls through untouched, which is correct here —
     * upload and the cron both enqueue through this function, and
     * automatically re-running finished work is provider spend nobody
     * asked for.
     *
     * An explicit retry needs a new identity, not a new attempt at the
     * old one. That is `requeueFileIndexJob` below, and it is the only
     * caller that should bump a generation.
     */
    update: {},
    select: { id: true, state: true },
  });

  if (
    job.state === FileIndexJobState.FAILED ||
    job.state === FileIndexJobState.CANCELLED
  ) {
    await client.fileIndexJob.update({
      where: { id: job.id },
      data: {
        state: FileIndexJobState.QUEUED,
        runAfter: input.runAfter ?? new Date(),
        lastError: null,
      },
    });
  }

  return job.id;
}

export interface RequeueOutcome {
  jobId: string;
  /**
   * True when this call made work runnable that was not runnable before.
   *
   * The caller has to be able to tell the difference. `POST .../reindex`
   * returned 200 `{ queued: true }` for a document whose EXTRACT and
   * SUGGEST had both SUCCEEDED, having queued nothing at all — the same
   * quiet lie this feature has produced repeatedly, in the one place
   * whose whole purpose is recovery.
   */
  queued: boolean;
  generation: number;
}

/**
 * Queue a fresh attempt at work that has already finished.
 *
 * `enqueueFileIndexJob` cannot do this and should not learn how. Its
 * dedupe key is built from the resource, pipeline, content revision,
 * scope version and generation, and the route passed none of the last
 * two — so an explicit retry computed the key the original job already
 * had, the upsert matched it, `update: {}` changed nothing, and the
 * FAILED/CANCELLED requeue did not apply to a SUCCEEDED row. Reproduced
 * against a real database: two job rows before, two after, neither
 * leasable.
 *
 * Making `enqueueFileIndexJob` requeue SUCCEEDED for everyone would fix
 * it in the wrong place. Upload and the cron enqueue through the same
 * function, and re-running settled work automatically is provider spend
 * nobody asked for. So the new identity is minted here, on the side
 * where a person pressed a button.
 *
 * Already-pending work is left alone rather than duplicated. A QUEUED or
 * LEASED job at any generation means the thing the caller wants is
 * going to happen, and a second row would be a second paid evaluation
 * for one request.
 */
export async function requeueFileIndexJob(
  input: {
    resourceId: string;
    pipeline: FileIndexJobPipeline;
    contentRevision: number;
    requiredScopeVersion?: number;
    runAfter?: Date;
  },
  client: Prisma.TransactionClient = prisma,
): Promise<RequeueOutcome> {
  const requiredScopeVersion = input.requiredScopeVersion ?? 1;

  const existing = await client.fileIndexJob.findMany({
    where: {
      resourceId: input.resourceId,
      pipeline: input.pipeline,
      contentRevision: input.contentRevision,
      requiredScopeVersion,
    },
    select: { id: true, state: true, desiredGeneration: true },
    orderBy: { desiredGeneration: "desc" },
  });

  const pending = existing.find(
    (job) =>
      job.state === FileIndexJobState.QUEUED ||
      job.state === FileIndexJobState.LEASED,
  );
  if (pending) {
    return {
      jobId: pending.id,
      queued: false,
      generation: pending.desiredGeneration,
    };
  }

  const generation = (existing[0]?.desiredGeneration ?? 0) + 1;
  const jobId = await enqueueFileIndexJob(
    {
      resourceId: input.resourceId,
      pipeline: input.pipeline,
      contentRevision: input.contentRevision,
      requiredScopeVersion,
      desiredGeneration: generation,
      runAfter: input.runAfter,
    },
    client,
  );

  return { jobId, queued: true, generation };
}

export interface LeasedFileIndexJob {
  job: FileIndexJob;
  leaseOwner: string;
}

/**
 * Take one runnable job under a lease. `updateMany` on the id plus the state
 * it was read in is the compare-and-set: two runners racing for the same row
 * produce one winner and one zero-count loser.
 */
/**
 * Bring long-FAILED suggestion jobs back, a bounded number of times.
 *
 * `leaseNextFileIndexJob` leases QUEUED and expired-LEASED rows only.
 * `enqueueFileIndexJob` does move a FAILED row back to QUEUED, but its
 * only automatic caller is the extraction chain, which runs when a
 * document is re-extracted and on no timer; `requeueFileIndexJob`'s only
 * caller is the reindex route. So once `FILE_INDEX_JOB_MAX_ATTEMPTS` was
 * spent, nothing would look at that document again unless a person asked,
 * one document at a time.
 *
 * That made a long provider outage terminal. The circuit breaker means a
 * short one costs nothing, so the damage was a function of how long the
 * incident lasted rather than of how big the backlog was: measured, a
 * backlog was entirely FAILED by simulated hour six, and a healthy
 * provider afterwards never touched it again.
 *
 * ## SUGGEST only, deliberately
 *
 * A suggestion failure is usually about the provider, which comes back. An
 * extraction failure is usually about the document — a file the parser
 * cannot read is still unreadable tomorrow — and that already has its own
 * terminal states and its own route back through reindex. Reviving it on a
 * timer would retry a broken file forever for nothing.
 *
 * ## What a revival is, and what it is not
 *
 * It is not `deferFileIndexJob`, which decrements `attempt` and is an
 * unbounded-retry primitive. A revival spends one of
 * `FILE_INDEX_JOB_MAX_REVIVALS`, and when those are gone the job stays
 * FAILED for good. `lastError` is left in place: it is why this job failed
 * last time and it stays true until something else happens.
 */
export async function reviveFailedSuggestionJobs(input?: {
  now?: Date;
  limit?: number;
}): Promise<number> {
  const now = input?.now ?? new Date();
  const cutoff = new Date(now.getTime() - FILE_INDEX_JOB_REVIVE_AFTER_MS);

  // Selected first so the batch is bounded: `updateMany` has no limit.
  const due = await prisma.fileIndexJob.findMany({
    where: {
      pipeline: FileIndexJobPipeline.SUGGEST,
      state: FileIndexJobState.FAILED,
      revivals: { lt: FILE_INDEX_JOB_MAX_REVIVALS },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take: input?.limit ?? REVIVE_BATCH,
    select: { id: true },
  });
  if (due.length === 0) return 0;

  const { count } = await prisma.fileIndexJob.updateMany({
    where: {
      id: { in: due.map((job) => job.id) },
      // Re-checked in the write, because the read above is not a lock.
      state: FileIndexJobState.FAILED,
      revivals: { lt: FILE_INDEX_JOB_MAX_REVIVALS },
    },
    data: {
      state: FileIndexJobState.QUEUED,
      attempt: 0,
      revivals: { increment: 1 },
      runAfter: now,
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  return count;
}

export async function leaseNextFileIndexJob(input: {
  pipeline?: FileIndexJobPipeline;
  now?: Date;
}): Promise<LeasedFileIndexJob | null> {
  const now = input.now ?? new Date();
  const leaseOwner = randomUUID();

  const runnable = {
    pipeline: input.pipeline,
    runAfter: { lte: now },
    OR: [
      { state: FileIndexJobState.QUEUED },
      {
        state: FileIndexJobState.LEASED,
        leaseExpiresAt: { lt: now },
      },
    ],
  };

  let candidate = await prisma.fileIndexJob.findFirst({
    where: runnable,
    orderBy: { runAfter: "asc" },
  });

  if (!candidate && input.pipeline === FileIndexJobPipeline.SUGGEST) {
    /**
     * Nothing to lease is the only moment worth asking whether anything
     * is due for revival: it is when a backlog of FAILED rows actually
     * matters, and it keeps the sweep off the hot path entirely. The
     * drive-index cycle also calls the sweep directly, so the count is
     * visible in the cycle log; this is the second door, for a drain
     * that is not the cycle.
     */
    if ((await reviveFailedSuggestionJobs({ now })) > 0) {
      candidate = await prisma.fileIndexJob.findFirst({
        where: runnable,
        orderBy: { runAfter: "asc" },
      });
    }
  }

  if (!candidate) return null;

  const claimed = await prisma.fileIndexJob.updateMany({
    where: {
      id: candidate.id,
      state: candidate.state,
      fence: candidate.fence,
    },
    data: {
      state: FileIndexJobState.LEASED,
      attempt: { increment: 1 },
      fence: { increment: 1 },
      leaseOwner,
      leaseExpiresAt: new Date(now.getTime() + FILE_INDEX_JOB_LEASE_MS),
    },
  });
  if (claimed.count !== 1) return null;

  const job = await prisma.fileIndexJob.findUnique({
    where: { id: candidate.id },
  });
  if (!job) return null;

  return { job, leaseOwner };
}

/**
 * Register every namespace an attempt may write to *before* it writes. This
 * is what makes deletion able to find a crashed worker's leftovers: the
 * ledger, not a directory listing, is the record of what exists.
 */
export async function registerFileIndexArtifact(input: {
  jobId: string;
  attempt: number;
  fence: number;
  namespace: string;
  kind: string;
  client?: Prisma.TransactionClient;
}): Promise<void> {
  const client = input.client ?? prisma;
  await client.fileIndexArtifact.upsert({
    where: {
      jobId_attempt_namespace: {
        jobId: input.jobId,
        attempt: input.attempt,
        namespace: input.namespace,
      },
    },
    create: {
      jobId: input.jobId,
      attempt: input.attempt,
      fence: input.fence,
      namespace: input.namespace,
      kind: input.kind,
    },
    update: {},
  });
}

export async function completeFileIndexJob(input: {
  jobId: string;
  leaseOwner: string;
}): Promise<boolean> {
  const updated = await prisma.fileIndexJob.updateMany({
    where: {
      id: input.jobId,
      leaseOwner: input.leaseOwner,
      state: FileIndexJobState.LEASED,
    },
    data: {
      state: FileIndexJobState.SUCCEEDED,
      completedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
      lastError: null,
    },
  });
  return updated.count === 1;
}

/**
 * How long a job refused for capacity waits before it is offered again.
 *
 * Short, because the thing that refused it is a per-minute window. Jittered
 * so a drained queue does not come back as one wave.
 */
const DEFER_BACKOFF_MS = 30_000;

/**
 * Put a job back exactly as it was, because we refused it — not it.
 *
 * A capacity refusal is neither a success nor a failure, and the two
 * existing endings both lied about it. `completeFileIndexJob` recorded the
 * document as done with zero suggestions and it was never looked at again;
 * `failFileIndexJob` consumed one of `FILE_INDEX_JOB_MAX_ATTEMPTS`, so five
 * refusals failed a perfectly good document permanently. Leasing increments
 * `attempt`, so giving that increment back is what "as it was" means here.
 *
 * `lastError` is deliberately left alone: there was no error, and a previous
 * genuine one should not be erased by a queueing decision.
 */
export async function deferFileIndexJob(input: {
  jobId: string;
  leaseOwner: string;
  retryAfterMs?: number;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  const backoff = input.retryAfterMs ?? DEFER_BACKOFF_MS;
  const jitter = Math.floor(Math.random() * Math.min(backoff, 15_000));

  const updated = await prisma.fileIndexJob.updateMany({
    where: {
      id: input.jobId,
      leaseOwner: input.leaseOwner,
      state: FileIndexJobState.LEASED,
    },
    data: {
      state: FileIndexJobState.QUEUED,
      runAfter: new Date(now.getTime() + backoff + jitter),
      attempt: { decrement: 1 },
      leaseOwner: null,
      leaseExpiresAt: null,
    },
  });
  return updated.count === 1;
}

export async function failFileIndexJob(input: {
  jobId: string;
  leaseOwner: string;
  attempt: number;
  error: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const exhausted = input.attempt >= FILE_INDEX_JOB_MAX_ATTEMPTS;
  const backoff =
    RETRY_BACKOFF_MS[Math.min(input.attempt - 1, RETRY_BACKOFF_MS.length - 1)];
  // Spread retries so a shared outage does not resolve into one thundering
  // herd the moment the backoff expires.
  const jitter = Math.floor(Math.random() * Math.min(backoff, 30_000));

  await prisma.fileIndexJob.updateMany({
    where: { id: input.jobId, leaseOwner: input.leaseOwner },
    data: exhausted
      ? {
          state: FileIndexJobState.FAILED,
          lastError: input.error.slice(0, 500),
          completedAt: now,
          leaseOwner: null,
          leaseExpiresAt: null,
        }
      : {
          state: FileIndexJobState.QUEUED,
          lastError: input.error.slice(0, 500),
          runAfter: new Date(now.getTime() + backoff + jitter),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
  });
}

/**
 * True when this attempt may still activate its output: the lease is ours,
 * the fence has not moved, and the source has not been tombstoned or
 * re-revised underneath us.
 */
export async function canActivateFileIndexAttempt(input: {
  jobId: string;
  leaseOwner: string;
  fence: number;
  contentRevision: number;
}): Promise<boolean> {
  const job = await prisma.fileIndexJob.findUnique({
    where: { id: input.jobId },
    select: {
      leaseOwner: true,
      fence: true,
      state: true,
      resource: {
        select: { contentRevision: true, tombstonedAt: true },
      },
    },
  });
  if (!job) return false;
  if (job.state !== FileIndexJobState.LEASED) return false;
  if (job.leaseOwner !== input.leaseOwner) return false;
  if (job.fence !== input.fence) return false;
  if (job.resource.tombstonedAt) return false;
  return job.resource.contentRevision === input.contentRevision;
}
