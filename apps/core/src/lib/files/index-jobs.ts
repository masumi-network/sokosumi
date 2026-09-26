import { createHash, randomUUID } from "node:crypto";

import {
  type FileIndexJob,
  type FileIndexJobPipeline,
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
    // Re-enqueueing a settled job is an explicit retry: same identity, new
    // attempt. An in-flight job is left alone so a lease is never stolen.
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

export interface LeasedFileIndexJob {
  job: FileIndexJob;
  leaseOwner: string;
}

/**
 * Take one runnable job under a lease. `updateMany` on the id plus the state
 * it was read in is the compare-and-set: two runners racing for the same row
 * produce one winner and one zero-count loser.
 */
export async function leaseNextFileIndexJob(input: {
  pipeline?: FileIndexJobPipeline;
  now?: Date;
}): Promise<LeasedFileIndexJob | null> {
  const now = input.now ?? new Date();
  const leaseOwner = randomUUID();

  const candidate = await prisma.fileIndexJob.findFirst({
    where: {
      pipeline: input.pipeline,
      runAfter: { lte: now },
      OR: [
        { state: FileIndexJobState.QUEUED },
        {
          state: FileIndexJobState.LEASED,
          leaseExpiresAt: { lt: now },
        },
      ],
    },
    orderBy: { runAfter: "asc" },
  });
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
