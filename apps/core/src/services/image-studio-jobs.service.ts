import crypto from "node:crypto";

import {
  type Prisma,
  ProjectImageJobKind,
  ProjectImageJobStatus,
} from "@sokosumi/database";
import { put } from "@vercel/blob";

import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { getBetterAuthPublicBaseUrl, getEnv } from "@/config/env";
import {
  notFound,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  requireProjectAccess,
  requireProjectAccessForUser,
} from "@/lib/image-studio/access";
import {
  buildFalInput,
  cancelQueued,
  downloadImage,
  falModelForKind,
  fetchQueueResult,
  fetchQueueStatus,
  submitToQueue,
  uploadReference,
} from "@/lib/image-studio/fal-client";
import { readAssetBytes } from "@/services/image-studio-assets.service";

/**
 * The job lifecycle: submit once, settle once.
 *
 * Two properties are load-bearing and everything else here exists to serve
 * them.
 *
 * 1. **A paid request is never sent twice for one job row.** The row is
 *    written before the network call, and the right to make that call is a
 *    lease taken in a single conditional UPDATE. A second caller — a retried
 *    HTTP request, a concurrent agent tool call, a process that restarted —
 *    loses that UPDATE and returns the existing job without touching fal.
 *
 * 2. **A row whose submission outcome is unknown is never resubmitted.** Once
 *    `submitAttempts` is non-zero the row can only move forward. A crash
 *    between the lease and the response leaves `SUBMITTING`, and the sweeper
 *    resolves that to `SUBMISSION_UNCERTAIN` — never back to `PENDING`.
 */

/** How long a submitter may hold the lease before the sweeper calls it. */
const SUBMIT_LEASE_MS = 90_000;

/** Statuses that still cost concurrency budget. */
const ACTIVE_STATUSES: ProjectImageJobStatus[] = [
  ProjectImageJobStatus.PENDING,
  ProjectImageJobStatus.SUBMITTING,
  ProjectImageJobStatus.QUEUED,
  ProjectImageJobStatus.RUNNING,
];

const SPEND_WINDOW_MS = 60 * 60 * 1000;

export interface ImageJobSettings {
  aspectRatio: string;
  resolution: string;
  outputFormat: string;
  seed: number | null;
}

export const DEFAULT_SETTINGS: ImageJobSettings = {
  aspectRatio: "1:1",
  resolution: "1K",
  outputFormat: "png",
  seed: null,
};

export interface CreateImageJobInput {
  projectId: string;
  workspaceId: string;
  userId: string;
  sessionId: string | null;
  prompt: string;
  settings: ImageJobSettings;
  /** Assets whose bytes become references. Empty means text-to-image. */
  referenceAssetIds: string[];
  /** The version being refined, when the user started from a selection. */
  parentAssetId: string | null;
  idempotencyKey: string;
}

function readSettings(value: Prisma.JsonValue): ImageJobSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return DEFAULT_SETTINGS;
  }
  const raw = value as Record<string, unknown>;
  return {
    aspectRatio:
      typeof raw.aspectRatio === "string"
        ? raw.aspectRatio
        : DEFAULT_SETTINGS.aspectRatio,
    resolution:
      typeof raw.resolution === "string"
        ? raw.resolution
        : DEFAULT_SETTINGS.resolution,
    outputFormat:
      typeof raw.outputFormat === "string"
        ? raw.outputFormat
        : DEFAULT_SETTINGS.outputFormat,
    seed: typeof raw.seed === "number" ? raw.seed : null,
  };
}

/**
 * Reserve a job row, or hand back the one this key already made.
 *
 * Counting the in-flight jobs and inserting the new one have to be the same
 * operation. As two statements, concurrent submissions all read the same count,
 * all pass the limit, and each then buys an image — the cap would bound a
 * serial loop and not a burst. This is the same reasoning, and the same helper,
 * that `soko-bot-avatar.service.ts` uses for its generation cap.
 */
async function reserveJob(input: CreateImageJobInput) {
  try {
    return await reserveJobTransaction(input);
  } catch (error) {
    // Two callers passed the existence check together and the index caught the
    // loser. The answer the caller wants is the row that won — but the losing
    // statement aborted its transaction, so it has to be read on a fresh one.
    // Re-querying inside the aborted transaction raised P2039 (SQLSTATE 25P02)
    // and turned a handled race into a 500.
    if (!isUniqueViolation(error)) throw error;
    const winner = await prisma.projectImageJob.findUnique({
      where: {
        projectId_idempotencyKey: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    if (!winner) throw error;
    return { job: winner, created: false };
  }
}

async function reserveJobTransaction(input: CreateImageJobInput) {
  return await serializableTransaction(async (tx) => {
    const existing = await tx.projectImageJob.findUnique({
      where: {
        projectId_idempotencyKey: {
          projectId: input.projectId,
          idempotencyKey: input.idempotencyKey,
        },
      },
    });
    // The replay answer. Returning the existing row — rather than creating a
    // second one — is what makes the HTTP endpoint safe to retry.
    if (existing) return { job: existing, created: false };

    const inFlight = await tx.projectImageJob.count({
      where: { projectId: input.projectId, status: { in: ACTIVE_STATUSES } },
    });
    if (inFlight >= LIMITS.IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT) {
      throw tooManyRequests(
        `This project already has ${LIMITS.IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT} images being generated. Wait for one to finish.`,
        { kind: "image_studio_project_busy" },
      );
    }

    const recent = await tx.projectImageJob.count({
      where: {
        requestedByUserId: input.userId,
        createdAt: { gte: new Date(Date.now() - SPEND_WINDOW_MS) },
      },
    });
    if (recent >= LIMITS.IMAGE_STUDIO_GENERATIONS_PER_USER_PER_HOUR) {
      throw tooManyRequests(
        `You can start at most ${LIMITS.IMAGE_STUDIO_GENERATIONS_PER_USER_PER_HOUR} image generations per hour.`,
        { kind: "image_studio_rate_limited" },
      );
    }

    const kind =
      input.referenceAssetIds.length > 0
        ? ProjectImageJobKind.EDIT
        : ProjectImageJobKind.GENERATE;

    // A unique violation here aborts this transaction. It is caught by the
    // caller, on a fresh connection, because the aborted one cannot answer
    // another query.
    const job = await tx.projectImageJob.create({
      data: {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        requestedByUserId: input.userId,
        kind,
        model: falModelForKind(kind),
        prompt: input.prompt,
        settings: { ...input.settings },
        referenceAssetIds: input.referenceAssetIds,
        parentAssetId: input.parentAssetId,
        idempotencyKey: input.idempotencyKey,
        status: ProjectImageJobStatus.PENDING,
      },
    });
    return { job, created: true };
  }, "Another image request is being accepted for this project. Try again.");
}

/**
 * Take the exclusive right to send this job to fal.
 *
 * One conditional UPDATE, guarded on the row still being `PENDING` with no
 * prior attempt. Postgres serializes the two writers; the loser's `count` is
 * zero and it simply does not call the provider. This is the whole answer to
 * "two callers with the same key must not each reach fal".
 */
async function claimForSubmission(jobId: string): Promise<boolean> {
  const claimed = await prisma.projectImageJob.updateMany({
    where: {
      id: jobId,
      status: ProjectImageJobStatus.PENDING,
      submitAttempts: 0,
    },
    data: {
      status: ProjectImageJobStatus.SUBMITTING,
      submitLeaseAt: new Date(),
      submitAttempts: { increment: 1 },
    },
  });
  return claimed.count === 1;
}

/**
 * Take the exclusive right to settle this job.
 *
 * Reuses `submitLeaseAt`: a job being settled is past submission, so the field
 * is free, and one conditional UPDATE is all the mutual exclusion this needs.
 * A settler that dies leaves the lease behind; the deadline is what lets the
 * next one through.
 */
async function claimForSettlement(jobId: string): Promise<boolean> {
  const deadline = new Date(Date.now() - SETTLE_LEASE_MS);
  const claimed = await prisma.projectImageJob.updateMany({
    where: {
      id: jobId,
      status: {
        in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
      },
      OR: [{ submitLeaseAt: null }, { submitLeaseAt: { lt: deadline } }],
    },
    data: { submitLeaseAt: new Date() },
  });
  return claimed.count === 1;
}

/** Long enough for a download and an upload, short enough to retry. */
const SETTLE_LEASE_MS = 180_000;

/**
 * Turn the assets a refinement names into URLs fal can read.
 *
 * The bytes are copied into fal's own storage. Our originals stay in private
 * storage and never acquire a durable public URL, so nothing in a job record,
 * an API response, or a tool result hands out a readable handle on them.
 */
async function buildReferenceUrls(job: {
  projectId: string;
  referenceAssetIds: string[];
}): Promise<string[]> {
  if (job.referenceAssetIds.length === 0) return [];
  if (
    job.referenceAssetIds.length > LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB
  ) {
    throw unprocessableEntity(
      `At most ${LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB} reference images are allowed.`,
    );
  }
  const assets = await prisma.projectImageAsset.findMany({
    where: { id: { in: job.referenceAssetIds }, projectId: job.projectId },
    select: { id: true, blobPathname: true, contentType: true, bytes: true },
  });
  if (assets.length !== job.referenceAssetIds.length) {
    throw notFound("A reference image was not found in this project");
  }

  const urls: string[] = [];
  // Order matters to the model, so follow the caller's order rather than the
  // order the database happened to return.
  for (const assetId of job.referenceAssetIds) {
    const asset = assets.find((candidate) => candidate.id === assetId);
    if (!asset)
      throw notFound("A reference image was not found in this project");
    if (asset.bytes > LIMITS.IMAGE_STUDIO_MAX_REFERENCE_BYTES) {
      throw unprocessableEntity("A reference image is too large to send.");
    }
    const bytes = await readAssetBytes(asset.blobPathname);
    urls.push(
      await uploadReference({
        bytes,
        contentType: asset.contentType,
        fileName: `${asset.id}.${asset.contentType.split("/")[1] ?? "png"}`,
      }),
    );
  }
  return urls;
}

function webhookUrl(): string | null {
  // Core's own public origin: the callback has to arrive here, not at Web.
  const base = getBetterAuthPublicBaseUrl();
  // A webhook only works from somewhere fal can reach. Local development
  // registers nothing and settles by polling instead, which is why
  // `reconcileProjectJobs` exists.
  if (
    !base ||
    base.includes("localhost") ||
    base.includes("127.0.0.1") ||
    base.startsWith("http://")
  ) {
    return null;
  }
  return `${base.replace(/\/$/, "")}/webhooks/fal/image-jobs`;
}

/**
 * Create (or replay) a job and, when this caller owns the lease, send it.
 */
export async function createImageJob(input: CreateImageJobInput) {
  await requireProjectAccess({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  const { job, created } = await reserveJob(input);
  if (!created) return job;

  if (!(await claimForSubmission(job.id))) {
    // Someone else is already sending this row. Never a second call.
    return (await prisma.projectImageJob.findUnique({
      where: { id: job.id },
    }))!;
  }

  return await sendClaimedJob(job.id);
}

/** Sends a job whose lease this caller already holds. */
async function sendClaimedJob(jobId: string) {
  const job = await prisma.projectImageJob.findUniqueOrThrow({
    where: { id: jobId },
  });

  let imageUrls: string[];
  try {
    imageUrls = await buildReferenceUrls(job);
  } catch (error) {
    // Nothing reached the generation queue, so this is a plain failure and the
    // user may retry without risk of a second charge.
    return await prisma.projectImageJob.update({
      where: { id: job.id },
      data: {
        status: ProjectImageJobStatus.FAILED,
        error:
          error instanceof Error ? error.message : "reference upload failed",
        settledAt: new Date(),
        submitLeaseAt: null,
      },
    });
  }

  const settings = readSettings(job.settings);
  const outcome = await submitToQueue({
    model: job.model,
    input: buildFalInput({
      prompt: job.prompt,
      aspectRatio: settings.aspectRatio,
      resolution: settings.resolution,
      outputFormat: settings.outputFormat,
      seed: settings.seed,
      imageUrls,
    }),
    webhookUrl: webhookUrl(),
  });

  switch (outcome.kind) {
    case "queued":
      return await prisma.projectImageJob.update({
        where: { id: job.id },
        data: {
          status: ProjectImageJobStatus.QUEUED,
          falRequestId: outcome.requestId,
          submittedAt: new Date(),
          submitLeaseAt: null,
        },
      });
    case "rejected":
      return await prisma.projectImageJob.update({
        where: { id: job.id },
        data: {
          status: ProjectImageJobStatus.FAILED,
          error: outcome.message,
          settledAt: new Date(),
          submitLeaseAt: null,
        },
      });
    case "uncertain":
      return await prisma.projectImageJob.update({
        where: { id: job.id },
        data: {
          status: ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
          error: outcome.message,
          submitLeaseAt: null,
        },
      });
  }
}

/**
 * Resolve rows whose submitter never came back.
 *
 * The only move allowed here is `SUBMITTING` -> `SUBMISSION_UNCERTAIN`. Moving
 * it back to `PENDING` would let the next sweep submit it again, and the whole
 * reason the row is stuck is that we do not know whether the first attempt
 * reached fal. The row stays, and it keeps counting against the hourly window,
 * because it may represent money.
 */
export async function sweepStalledSubmissions(
  now: Date = new Date(),
): Promise<number> {
  const result = await prisma.projectImageJob.updateMany({
    where: {
      status: ProjectImageJobStatus.SUBMITTING,
      submitLeaseAt: { lt: new Date(now.getTime() - SUBMIT_LEASE_MS) },
    },
    data: {
      status: ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
      error: "The submitting process stopped before fal answered.",
      submitLeaseAt: null,
    },
  });
  return result.count;
}

/**
 * Ask fal what happened, and settle the job if it has an answer.
 *
 * Safe to call from a webhook, a status read, or the cron sweep. Settlement is
 * keyed on the job row, so concurrent callers converge on one asset.
 */
export async function reconcileJob(jobId: string): Promise<void> {
  const job = await prisma.projectImageJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (!job.falRequestId) return;
  if (
    job.status !== ProjectImageJobStatus.QUEUED &&
    job.status !== ProjectImageJobStatus.RUNNING
  ) {
    return;
  }

  const status = await fetchQueueStatus({
    model: job.model,
    requestId: job.falRequestId,
  });

  // A read that never reached fal tells us nothing about the job, so it must
  // not settle it. Count it, keep the row live, and let a later attempt — or
  // the provider's own callback — finish it. Only a run of failures long
  // enough to be structural gives up.
  if (status.kind === "unreachable") {
    await noteUnreachable(job.id, status.message);
    return;
  }

  await prisma.projectImageJob.updateMany({
    where: { id: job.id },
    data: { polledAt: new Date(), pollFailures: 0, lastPollError: null },
  });

  switch (status.kind) {
    case "in_queue":
      return;
    case "in_progress":
      await prisma.projectImageJob.updateMany({
        where: { id: job.id, status: ProjectImageJobStatus.QUEUED },
        data: { status: ProjectImageJobStatus.RUNNING },
      });
      return;
    case "not_found":
      // fal answered, and the answer is that the request is gone. Nothing more
      // is coming, so this one really is terminal — but if somebody asked for
      // it to stop, "gone" means the cancellation took, and calling that a
      // failure misreports what happened.
      if (job.cancelRequestedAt) {
        await prisma.projectImageJob.updateMany({
          where: {
            id: job.id,
            status: {
              in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
            },
          },
          data: {
            status: ProjectImageJobStatus.CANCELED,
            settledAt: new Date(),
            error: "Cancelled before the provider produced an image.",
          },
        });
        return;
      }
      await failJob(job.id, "fal no longer has this request");
      return;
    case "error":
      await failJob(job.id, status.message);
      return;
    case "completed":
      break;
  }

  const result = await fetchQueueResult({
    model: job.model,
    requestId: job.falRequestId,
  });
  if (result.kind === "pending") return;
  if (result.kind === "unreachable") {
    await noteUnreachable(job.id, result.message);
    return;
  }
  if (result.kind === "error") {
    await failJob(job.id, result.message);
    return;
  }
  // Settled even when cancellation was requested: fal may accept a
  // cancellation and finish anyway, and an image we paid for should be kept.
  await settleWithImage(job.id, result.images[0]!.url);
}

/**
 * How long the provider may stay unreachable for one request before we stop.
 *
 * Measured against wall-clock time since submission, not a count of attempts.
 * A count is not a duration: the browser polls every three seconds and several
 * readers can poll at once, so a twelve-attempt budget could be spent in under
 * a minute of one bad connection — and the job, already paid for, was gone.
 */
const UNREACHABLE_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Record a read that never reached the provider.
 *
 * Never settles the job on its own. It gives up only once the request has been
 * outstanding for {@link UNREACHABLE_GRACE_MS}, and even then the job is marked
 * as possibly charged, because we never got an answer either way.
 */
async function noteUnreachable(jobId: string, message: string): Promise<void> {
  const updated = await prisma.projectImageJob.update({
    where: { id: jobId },
    data: {
      polledAt: new Date(),
      pollFailures: { increment: 1 },
      lastPollError: message.slice(0, 500),
      // Whoever held the settle lease is done with it; the next reader should
      // not have to wait out the deadline.
      submitLeaseAt: null,
    },
    select: { pollFailures: true, submittedAt: true, createdAt: true },
  });

  const startedAt = updated.submittedAt ?? updated.createdAt;
  if (Date.now() - startedAt.getTime() < UNREACHABLE_GRACE_MS) return;

  await prisma.projectImageJob.updateMany({
    where: {
      id: jobId,
      status: {
        in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
      },
    },
    data: {
      // Not FAILED: this request was sent and may well have been billed, so
      // offering a retry that looks free would be a lie. The uncertain status
      // is what makes the UI say so.
      status: ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
      error: `The provider could not be reached for this request for ${Math.round(
        UNREACHABLE_GRACE_MS / 3_600_000,
      )} hours (${message.slice(0, 200)}).`,
      settledAt: new Date(),
    },
  });
}

/**
 * Settle a job on a definite answer from the provider.
 *
 * Only for verdicts: a runner error, a refused request, a request fal says it
 * no longer has. Never for a read that did not arrive — that is
 * {@link noteUnreachable}.
 */
async function failJob(jobId: string, message: string): Promise<void> {
  await prisma.projectImageJob.updateMany({
    where: {
      id: jobId,
      status: {
        in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
      },
    },
    data: {
      status: ProjectImageJobStatus.FAILED,
      error: message.slice(0, 500),
      settledAt: new Date(),
      submitLeaseAt: null,
    },
  });
}

/**
 * Store the generated image and publish the version.
 *
 * Idempotent on the job: `ProjectImageAsset.jobId` is unique, so a webhook and
 * a poll arriving together produce one asset and one of them loses the insert.
 */
export async function settleWithImage(
  jobId: string,
  sourceUrl: string,
): Promise<void> {
  const job = await prisma.projectImageJob.findUnique({
    where: { id: jobId },
    include: { asset: { select: { id: true } } },
  });
  if (!job || job.asset) return;
  if (
    job.status !== ProjectImageJobStatus.QUEUED &&
    job.status !== ProjectImageJobStatus.RUNNING
  ) {
    return;
  }

  // One settler does the paid work. A webhook, a page load and the cron can
  // all arrive together, and the unique index on `jobId` deduplicates the
  // *row* — but only after each of them has already downloaded the image and
  // written it to storage. The lease moves that deduplication in front of the
  // network, so the work happens once rather than being undone afterwards.
  if (!(await claimForSettlement(job.id))) return;

  // Re-check the destination *and* the person who asked for this, at the
  // moment the image arrives.
  //
  // There is no request context here — this runs from a webhook, a cron, or
  // somebody else's page load — so the check has to be made explicitly.
  // Without it, a job started by someone who has since been removed from the
  // organization still downloaded the image, wrote it into blob storage, and
  // published a version into a project they can no longer see.
  let project: { id: string; workspaceId: string };
  try {
    const access = await requireProjectAccessForUser({
      projectId: job.projectId,
      userId: job.requestedByUserId,
    });
    project = { id: access.projectId, workspaceId: access.workspaceId };
  } catch (error) {
    if (!isAccessDenied(error)) {
      // We could not find out. That is not a refusal, and discarding a paid
      // image because a connection blipped is the worse of the two mistakes.
      // Leave the job live; a later reconcile or the cron will ask again.
      await noteUnreachable(
        job.id,
        error instanceof Error
          ? `access check unavailable: ${error.message}`
          : "access check unavailable",
      );
      return;
    }
    // A real refusal: the project is gone, or the requester no longer has
    // access to it. Nothing is downloaded and nothing is stored.
    await prisma.projectImageJob.updateMany({
      where: { id: job.id },
      data: {
        status: ProjectImageJobStatus.ORPHANED,
        error:
          "The image was discarded: the project or the requester's access to it is gone.",
        settledAt: new Date(),
      },
    });
    return;
  }

  const env = getEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    await failJob(job.id, "Image storage is not configured.");
    return;
  }

  let downloaded: Awaited<ReturnType<typeof downloadImage>>;
  try {
    downloaded = await downloadImage(
      sourceUrl,
      LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES,
    );
  } catch (error) {
    // fal has already produced the image, so it has already been paid for. A
    // failed download is our problem, not a verdict on the job: leave the row
    // live so a later reconcile or the webhook can fetch it again rather than
    // offering the person another paid generation.
    await noteUnreachable(
      job.id,
      error instanceof Error ? error.message : "image download failed",
    );
    return;
  }

  const checksum = crypto
    .createHash("sha256")
    .update(downloaded.bytes)
    .digest("hex");
  const dimensions = readPngDimensions(downloaded.bytes);

  // Private, so the bytes are only reachable through the authorized streaming
  // route, which checks access per request. The pathname is therefore a
  // storage coordinate, not a secret, and it is deliberately deterministic:
  // a random suffix meant that settlers racing the same job each wrote their
  // own object, and the losers' objects were left behind with nothing
  // referencing them. One job, one object, overwritten idempotently.
  const blob = await put(
    `projects/${job.projectId}/image-studio/${job.id}-${checksum.slice(0, 16)}`,
    downloaded.bytes as unknown as Buffer,
    {
      access: "private",
      contentType: downloaded.contentType,
      token: env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
      abortSignal: AbortSignal.timeout(60_000),
    },
  );

  try {
    await insertAsset({
      job: {
        id: job.id,
        projectId: project.id,
        workspaceId: project.workspaceId,
        model: job.model,
        prompt: job.prompt,
        settings: job.settings,
        parentAssetId: job.parentAssetId,
      },
      blobPathname: blob.pathname,
      contentType: downloaded.contentType,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      bytes: downloaded.bytes.byteLength,
      checksum,
    });
  } catch (error) {
    if (isUniqueViolation(error)) return; // Another settler won; its asset stands.
    throw error;
  }
}

/**
 * Insert the version and take its number.
 *
 * Version allocation is a read-then-write, so it runs serializable and the
 * `(rootId, version)` unique index backs it up: if two settlements in one
 * lineage still collide, the loser aborts and the helper retries it against a
 * count that now includes the winner.
 */
async function insertAsset(input: {
  job: {
    id: string;
    projectId: string;
    workspaceId: string;
    model: string;
    prompt: string;
    settings: Prisma.JsonValue;
    parentAssetId: string | null;
  };
  blobPathname: string;
  contentType: string;
  width: number;
  height: number;
  bytes: number;
  checksum: string;
}): Promise<void> {
  await serializableTransaction(async (tx) => {
    const existing = await tx.projectImageAsset.findUnique({
      where: { jobId: input.job.id },
      select: { id: true },
    });
    if (existing) return;

    let rootId: string | null = null;
    if (input.job.parentAssetId) {
      const parent = await tx.projectImageAsset.findFirst({
        where: {
          id: input.job.parentAssetId,
          projectId: input.job.projectId,
        },
        select: { rootId: true },
      });
      // A parent that vanished demotes the result to its own family rather
      // than losing the image.
      rootId = parent?.rootId ?? null;
    }

    const id = crypto.randomUUID();
    const family = rootId ?? id;
    const highest = await tx.projectImageAsset.findFirst({
      where: { rootId: family },
      orderBy: { version: "desc" },
      select: { version: true },
    });

    await tx.projectImageAsset.create({
      data: {
        id,
        projectId: input.job.projectId,
        workspaceId: input.job.workspaceId,
        jobId: input.job.id,
        rootId: family,
        parentId: rootId ? input.job.parentAssetId : null,
        version: (highest?.version ?? 0) + 1,
        model: input.job.model,
        prompt: input.job.prompt,
        settings: input.job.settings ?? {},
        blobPathname: input.blobPathname,
        contentType: input.contentType,
        width: input.width,
        height: input.height,
        bytes: input.bytes,
        checksum: input.checksum,
      },
    });

    await tx.projectImageJob.updateMany({
      where: { id: input.job.id },
      data: {
        status: ProjectImageJobStatus.SUCCEEDED,
        settledAt: new Date(),
        error: null,
        submitLeaseAt: null,
      },
    });
  }, "Another image finished in this lineage at the same moment. Try again.");
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/**
 * Bring a project's in-flight jobs up to date before reading them.
 *
 * This is what makes the studio work where fal cannot reach us — local
 * development and preview deployments have no callable webhook URL, so the
 * poll a client is already making is the settlement path. In production it is
 * the backstop for a delivery that never arrived.
 *
 * Bounded on purpose: a handful of provider reads per page load, never a scan.
 */
export async function reconcileProjectJobs(projectId: string): Promise<void> {
  await sweepStalledSubmissions();
  // Deployments without a reachable webhook settle here, so this is also where
  // a reservation stranded by a crashed request gets picked back up.
  await recoverUnclaimedReservations({ projectId }).catch((error) => {
    console.warn("[image-studio] reservation recovery failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
  });
  const pending = await prisma.projectImageJob.findMany({
    where: {
      projectId,
      status: {
        in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
      },
    },
    orderBy: { createdAt: "asc" },
    take: LIMITS.IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT,
    select: { id: true },
  });
  // Sequential: these are the same small set the project is limited to, and a
  // burst of provider reads from one page load buys nothing.
  for (const job of pending) {
    try {
      await reconcileJob(job.id);
    } catch (error) {
      console.warn("[image-studio] reconcile failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

/**
 * The cron sweep: jobs nobody is watching.
 *
 * Vercel runs crons on production only, which is precisely why
 * `reconcileProjectJobs` exists as well.
 */
export async function reconcileStaleJobs(options: {
  olderThanMs: number;
  limit: number;
}): Promise<{
  swept: number;
  reconciled: number;
  recovered: number;
  abandoned: number;
  cancelled: number;
}> {
  const swept = await sweepStalledSubmissions();
  // Reservations whose process died before it reached fal. Provably unsent,
  // so finishing them costs nothing that was not already intended.
  const recovery = await recoverUnclaimedReservations();
  const cancelled = await finaliseCancellations(options.limit);
  const stale = await prisma.projectImageJob.findMany({
    where: {
      status: {
        in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
      },
      updatedAt: { lt: new Date(Date.now() - options.olderThanMs) },
    },
    orderBy: { updatedAt: "asc" },
    take: options.limit,
    select: { id: true },
  });
  let reconciled = 0;
  for (const job of stale) {
    try {
      await reconcileJob(job.id);
      reconciled += 1;
    } catch (error) {
      console.warn("[image-studio] stale reconcile failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return {
    swept,
    reconciled,
    recovered: recovery.submitted,
    abandoned: recovery.abandoned,
    cancelled,
  };
}

/**
 * Request cancellation.
 *
 * fal only signals the runner for a request already in progress, so this is a
 * request and not a guarantee, and it says nothing about billing. The status
 * we write says "we asked", and the UI says the same.
 */
export async function requestCancel(options: {
  jobId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
}): Promise<{ accepted: boolean }> {
  await requireProjectAccess(options);
  const job = await prisma.projectImageJob.findFirst({
    where: { id: options.jobId, projectId: options.projectId },
  });
  if (!job) throw notFound("Image request not found");
  if (!job.falRequestId) {
    throw unprocessableEntity("This request has not reached the provider yet.");
  }
  const outcome = await cancelQueued({
    model: job.model,
    requestId: job.falRequestId,
  });

  if (outcome === "accepted") {
    // Recorded as a request, not as an outcome. fal documents that a request
    // already in progress is only signalled, so it can still finish — and when
    // it does we keep the image rather than throwing away something paid for.
    // The job stays live and keeps reconciling.
    await prisma.projectImageJob.updateMany({
      where: {
        id: job.id,
        status: {
          in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
        },
        cancelRequestedAt: null,
      },
      data: { cancelRequestedAt: new Date() },
    });
  }

  if (outcome === "already_finished") {
    // Nothing to cancel; let the normal reconcile collect the result.
    await reconcileJob(job.id).catch(() => {});
  }

  return { accepted: outcome === "accepted" };
}

/**
 * Settle a job the provider confirms it never started.
 *
 * Only reached from the sweep, and only for a job whose cancellation was
 * requested and which fal now reports as gone. This is the one path that
 * writes CANCELED, and by then the provider has already said there is no
 * result coming.
 */
async function finaliseCancellations(limit: number): Promise<number> {
  const requested = await prisma.projectImageJob.findMany({
    where: {
      cancelRequestedAt: { not: null },
      status: {
        in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
      },
    },
    orderBy: { cancelRequestedAt: "asc" },
    take: limit,
    select: { id: true, model: true, falRequestId: true },
  });

  let finalised = 0;
  for (const job of requested) {
    if (!job.falRequestId) continue;
    const status = await fetchQueueStatus({
      model: job.model,
      requestId: job.falRequestId,
    });
    // Unreachable says nothing; leave it for the next pass.
    if (status.kind === "unreachable") continue;
    if (status.kind === "not_found") {
      const settled = await prisma.projectImageJob.updateMany({
        where: {
          id: job.id,
          status: {
            in: [ProjectImageJobStatus.QUEUED, ProjectImageJobStatus.RUNNING],
          },
        },
        data: {
          status: ProjectImageJobStatus.CANCELED,
          settledAt: new Date(),
          error: "Cancelled before the provider produced an image.",
        },
      });
      finalised += settled.count;
      continue;
    }
    // Still queued, running, or finished: the ordinary reconcile handles it,
    // including keeping an image that arrived despite the cancellation.
    await reconcileJob(job.id).catch(() => {});
  }
  return finalised;
}

/**
 * Recover a reservation whose process died before it claimed the submission.
 *
 * A row created by `reserveJob` but never claimed has provably not reached
 * fal: `submitAttempts` is still zero, and the claim and the network call are
 * the same step. Nothing was bought, so this is safe to finish — unlike
 * `SUBMITTING`, which must never go backwards.
 *
 * Without this, a crash in that window left a `PENDING` row consuming the
 * project's concurrency budget for ever, and the replay path handed every
 * retry the same stuck row.
 */
export async function recoverUnclaimedReservations(
  options: { projectId?: string; now?: Date } = {},
): Promise<{ submitted: number; abandoned: number; denied: number }> {
  const now = options.now ?? new Date();
  const stale = await prisma.projectImageJob.findMany({
    where: {
      ...(options.projectId ? { projectId: options.projectId } : {}),
      status: ProjectImageJobStatus.PENDING,
      submitAttempts: 0,
      createdAt: { lt: new Date(now.getTime() - PENDING_RECOVERY_AFTER_MS) },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: {
      id: true,
      createdAt: true,
      projectId: true,
      requestedByUserId: true,
    },
  });

  let submitted = 0;
  let abandoned = 0;
  let denied = 0;
  for (const job of stale) {
    // Past this age the person who asked has long gone; releasing the slot is
    // kinder than buying an image nobody is waiting for.
    if (job.createdAt.getTime() < now.getTime() - PENDING_ABANDON_AFTER_MS) {
      const released = await prisma.projectImageJob.updateMany({
        where: {
          id: job.id,
          status: ProjectImageJobStatus.PENDING,
          submitAttempts: 0,
        },
        data: {
          status: ProjectImageJobStatus.FAILED,
          error:
            "Abandoned before it was sent to the provider. Nothing was charged.",
          settledAt: new Date(),
        },
      });
      abandoned += released.count;
      continue;
    }

    // Recovery buys an image, so it needs the same permission the original
    // request needed — and it runs minutes later, with no request context, so
    // it has to ask again. Without this, a reservation left behind by someone
    // since removed from the organization was still sent to the provider and
    // charged.
    let permitted: boolean;
    try {
      await requireProjectAccessForUser({
        projectId: job.projectId,
        userId: job.requestedByUserId,
      });
      permitted = true;
    } catch (error) {
      if (!isAccessDenied(error)) {
        // Could not ask. Leave the row alone and try on the next sweep;
        // failing to check is not the same as being refused.
        console.warn("[image-studio] recovery access check unavailable", {
          jobId: job.id,
          error: error instanceof Error ? error.message : "unknown",
        });
        continue;
      }
      permitted = false;
    }

    if (!permitted) {
      const released = await prisma.projectImageJob.updateMany({
        where: {
          id: job.id,
          status: ProjectImageJobStatus.PENDING,
          submitAttempts: 0,
        },
        data: {
          status: ProjectImageJobStatus.ORPHANED,
          error:
            "Not sent: the project or the requester's access to it is gone. Nothing was charged.",
          settledAt: new Date(),
        },
      });
      denied += released.count;
      continue;
    }

    if (!(await claimForSubmission(job.id))) continue;
    try {
      await sendClaimedJob(job.id);
      submitted += 1;
    } catch (error) {
      console.warn("[image-studio] recovery submit failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return { submitted, abandoned, denied };
}

/**
 * True when an access check answered "no", false when it could not answer.
 *
 * `requireProjectAccess*` refuses with a 404 HTTPException. Anything else —
 * a dropped connection, a pool timeout — is the check being unavailable, and
 * treating that as a refusal throws away work that was perfectly authorized.
 */
function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof HTTPException ||
    (typeof error === "object" &&
      error !== null &&
      "status" in error &&
      (error as { status?: unknown }).status === 404)
  );
}

/** Old enough that its creator is not still waiting on the same request. */
const PENDING_RECOVERY_AFTER_MS = 60_000;
/** Old enough that sending it would surprise somebody. */
const PENDING_ABANDON_AFTER_MS = 30 * 60_000;

/**
 * Minimal PNG header read, so a stored version knows its own size without
 * pulling in an image library. Returns null for anything else; the column then
 * holds 0 and the UI falls back to the intrinsic size of the rendered image.
 */
export function readPngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (bytes.byteLength < 24) return null;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export { readSettings };
