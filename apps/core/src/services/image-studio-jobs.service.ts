import crypto from "node:crypto";

import {
  type Prisma,
  ProjectImageJobKind,
  ProjectImageJobStatus,
} from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/utils";
import { put } from "@vercel/blob";

import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { getBetterAuthPublicBaseUrl } from "@/config/env";
import { buildCompensatingRefundTransactionCreate } from "@/helpers/compensating-refund";
import {
  notFound,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import { createTaskEventTransaction } from "@/helpers/task-credits";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  requireProjectAccess,
  requireProjectAccessForUser,
} from "@/lib/image-studio/access";
import {
  readStudioBlobToken,
  requireStudioBlobToken,
} from "@/lib/image-studio/blob-store";
import { imageModel, resolveImageSettings } from "@/lib/image-studio/catalog";
import {
  type ImageJobFailureReason,
  imageJobFailureMessage,
} from "@/lib/image-studio/failure-reason";
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
import { creditsPerImage } from "@/lib/image-studio/image-model";
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
  modelId?: string;
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
 * What reserving a job needs beyond what the caller asked for.
 *
 * `chargedCredits` is computed once, outside the transaction, from the resolved
 * catalog — the same `creditsPerImage` figure the composer showed before anybody
 * pressed generate. Recomputing it inside the reservation would let a catalog
 * refresh land between the estimate and the debit, and the person would be
 * charged a number they were never shown.
 */
interface ReserveImageJobInput extends CreateImageJobInput {
  settings: ImageJobSettings;
  /** Null for a personal workspace; otherwise the pot being charged. */
  organizationId: string | null;
  /** Credits (= cents) to debit for this one image. */
  chargedCredits: number;
}

/**
 * Reserve a job row, or hand back the one this key already made.
 *
 * Counting the in-flight jobs, taking the credits, and inserting the new row all
 * have to be the same operation. As separate statements, concurrent submissions
 * all read the same count, all pass the limit, and each then buys an image — the
 * cap would bound a serial loop and not a burst. And a debit outside the insert
 * is a charge with no job to point at, or a job nobody paid for, depending on
 * which half failed. This is the same reasoning, and the same helper, that
 * `soko-bot-avatar.service.ts` uses for its generation cap.
 */
async function reserveJob(input: ReserveImageJobInput) {
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

async function reserveJobTransaction(input: ReserveImageJobInput) {
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

    // Taken before the insert and inside the same transaction. An insufficient
    // balance throws the existing 422 INSUFFICIENT_BALANCE from here, so no row
    // is written and fal is never called: "not enough credits" costs nothing and
    // leaves nothing behind.
    const chargedCents = convertCreditsToCents(input.chargedCredits);
    const transactionId = await createTaskEventTransaction({
      userId: input.userId,
      organizationId: input.organizationId,
      cents: chargedCents,
      tx,
    });

    // A unique violation here aborts this transaction — including the debit
    // above, which is why the two are one transaction. It is caught by the
    // caller, on a fresh connection, because the aborted one cannot answer
    // another query.
    const job = await tx.projectImageJob.create({
      data: {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        requestedByUserId: input.userId,
        kind,
        model: falModelForKind(kind, input.modelId),
        prompt: input.prompt,
        settings: { ...input.settings },
        referenceAssetIds: input.referenceAssetIds,
        parentAssetId: input.parentAssetId,
        idempotencyKey: input.idempotencyKey,
        status: ProjectImageJobStatus.PENDING,
        chargedCents,
        transactionId,
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
 * States in which the provider may still have something to tell us.
 *
 * `SUBMISSION_UNCERTAIN` belongs here. It means we lost contact, not that the
 * request was lost: the job may well be running, and if we hold its
 * `falRequestId` we can still ask. Treating it as terminal made every paid
 * image behind a six-hour outage permanently unreachable — polling, the cron
 * and the completion callback all refused to look at it again.
 *
 * Recovery never re-submits. Submission is the part that costs money and is
 * fenced by `submitAttempts`; this is only ever reading and settling.
 */
const LIVE_STATUSES = [
  ProjectImageJobStatus.QUEUED,
  ProjectImageJobStatus.RUNNING,
  ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
] as const;

/**
 * The rows a bounded provider-recovery sweep may usefully pick up.
 *
 * Live *and* holding a provider request id. Without an id there is nothing to
 * ask the provider, so `reconcileJob` returns immediately and never touches
 * the row's ordering timestamp — which meant a handful of such rows sat at the
 * head of `updatedAt asc` forever and consumed the whole batch, starving every
 * job that could actually have made progress. They stay in the table, and the
 * no-resubmission fence still covers them; they are simply not candidates for
 * a sweep whose only tool is a provider read.
 */
function recoverableSelection() {
  return {
    status: { in: [...LIVE_STATUSES] },
    falRequestId: { not: null },
  };
}

/**
 * Take the exclusive right to settle this job.
 *
 * Reuses `submitLeaseAt`: a job being settled is past submission, so the field
 * is free, and one conditional UPDATE is all the mutual exclusion this needs.
 * A settler that dies leaves the lease behind; the deadline is what lets the
 * next one through.
 */
async function claimForSettlement(jobId: string): Promise<string | null> {
  const owner = crypto.randomUUID();
  const deadline = new Date(Date.now() - SETTLE_LEASE_MS);
  const claimed = await prisma.projectImageJob.updateMany({
    where: {
      id: jobId,
      status: { in: [...LIVE_STATUSES] },
      OR: [{ settleLeaseAt: null }, { settleLeaseAt: { lt: deadline } }],
    },
    data: { settleLeaseAt: new Date(), settleLeaseOwner: owner },
  });
  return claimed.count === 1 ? owner : null;
}

/**
 * Give the settlement lease back, if we are the ones holding it.
 *
 * Fenced by owner. An unconditional release let an unrelated failed status
 * read — which never held this lease — unlock a settler that was still
 * downloading, so two workers stored the same image at once.
 */
async function releaseSettlementLease(
  jobId: string,
  owner: string,
): Promise<void> {
  await prisma.projectImageJob.updateMany({
    where: { id: jobId, settleLeaseOwner: owner },
    data: { settleLeaseAt: null, settleLeaseOwner: null },
  });
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
  const access = await requireProjectAccess({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });

  // Checked before anything is reserved or sent, because the alternative is
  // paying fal for an image that then has nowhere it is allowed to go. The
  // first version of this bug did exactly that: generations completed at the
  // provider and were lost at settlement.
  requireStudioBlobToken();

  let settings: ImageJobSettings;
  try {
    settings = resolveImageSettings(
      input.modelId,
      input.settings,
      input.referenceAssetIds.length,
    );
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid image settings",
      { kind: "invalid_image_settings" },
    );
  }
  // The charge, decided here and nowhere else. Same catalog row, same function
  // and therefore the same number the composer's pre-flight estimate showed.
  let chargedCredits: number;
  try {
    chargedCredits = creditsPerImage(imageModel(input.modelId), settings);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid image settings",
      { kind: "invalid_image_settings" },
    );
  }

  const { job, created } = await reserveJob({
    ...input,
    settings,
    organizationId: access.organizationId,
    chargedCredits,
  });
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

  // Everything that has to happen before the paid call, in one try, because
  // everything that can fail in here is provably unsent: `submitToQueue` has not
  // been reached, so nothing was bought and the reservation's debit comes
  // straight back.
  //
  // `buildFalInput` used to sit outside this — an oversight that became a real
  // money bug the moment the catalog went live. It resolves `job.model` against
  // the *current* catalog, so a model fal withdraws between reservation and
  // submission made it throw, the exception escaped `createImageJob` as a 500,
  // and the row was left SUBMITTING with the charge taken. The sweeper then
  // called that SUBMISSION_UNCERTAIN, which is deliberately never refunded
  // automatically — so the person paid for a request that was never sent.
  let input: Record<string, unknown>;
  // Which half failed, so the person is told the right thing. Set before each
  // step rather than guessed from the message afterwards.
  let preflightReason: ImageJobFailureReason = "reference_not_sendable";
  try {
    const imageUrls = await buildReferenceUrls(job);
    const settings = readSettings(job.settings);
    preflightReason = "request_not_supported";
    input = buildFalInput(
      {
        prompt: job.prompt,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        outputFormat: settings.outputFormat,
        seed: settings.seed,
        imageUrls,
      },
      job.model,
    );
  } catch (error) {
    console.warn("[image-studio] a generation could not be prepared", {
      jobId: job.id,
      reason: preflightReason,
      detail: error instanceof Error ? error.message : "unknown",
    });
    const failed = await prisma.projectImageJob.update({
      where: { id: job.id },
      data: {
        status: ProjectImageJobStatus.FAILED,
        error: imageJobFailureMessage(preflightReason),
        failureReason: preflightReason,
        settledAt: new Date(),
        submitLeaseAt: null,
      },
    });
    await refundImageJobCharge(job.id);
    return failed;
  }

  const outcome = await submitToQueue({
    model: job.model,
    input,
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
    case "rejected": {
      // fal answered and refused, so it enqueued nothing and charged nothing.
      console.warn("[image-studio] provider refused a submission", {
        jobId: job.id,
        status: outcome.status,
        providerDetail: outcome.message.slice(0, 500),
      });
      const rejected = await prisma.projectImageJob.update({
        where: { id: job.id },
        data: {
          status: ProjectImageJobStatus.FAILED,
          error: imageJobFailureMessage("provider_rejected"),
          failureReason: "provider_rejected",
          settledAt: new Date(),
          submitLeaseAt: null,
        },
      });
      await refundImageJobCharge(job.id);
      return rejected;
    }
    case "uncertain":
      console.warn("[image-studio] submission outcome unknown", {
        jobId: job.id,
        providerDetail: outcome.message.slice(0, 500),
      });
      return await prisma.projectImageJob.update({
        where: { id: job.id },
        data: {
          status: ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
          error: imageJobFailureMessage("submission_uncertain"),
          failureReason: "submission_uncertain",
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
      error: imageJobFailureMessage("submission_uncertain"),
      failureReason: "submission_uncertain",
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
  // Without a provider request id there is nothing to ask about.
  if (!job.falRequestId) return;
  // Includes SUBMISSION_UNCERTAIN: we hold its request id, so the provider can
  // still tell us it succeeded. Refusing to look was what made paid images
  // behind an outage permanently unreachable.
  if (!(LIVE_STATUSES as readonly string[]).includes(job.status)) {
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
    await noteUnreachable(job.id, status.message, "status");
    return;
  }

  await prisma.projectImageJob.updateMany({
    where: { id: job.id },
    data: { polledAt: new Date() },
  });
  // Only the status read got through. A continuing result or authorization
  // failure keeps its own elapsed time.
  await noteReachable(job.id, "status");

  switch (status.kind) {
    case "in_queue":
      // The provider still has it. If we had given up on it, take that back.
      await prisma.projectImageJob.updateMany({
        where: {
          id: job.id,
          status: ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
        },
        data: { status: ProjectImageJobStatus.QUEUED, settledAt: null },
      });
      return;
    case "in_progress":
      await prisma.projectImageJob.updateMany({
        where: {
          id: job.id,
          status: {
            in: [
              ProjectImageJobStatus.QUEUED,
              ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
            ],
          },
        },
        data: { status: ProjectImageJobStatus.RUNNING, settledAt: null },
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
            status: { in: [...LIVE_STATUSES] },
          },
          data: {
            status: ProjectImageJobStatus.CANCELED,
            settledAt: new Date(),
            error: imageJobFailureMessage("cancelled"),
            failureReason: "cancelled",
          },
        });
        // fal says the request is gone and no image came of it, so the charge
        // goes back.
        await refundImageJobCharge(job.id);
        return;
      }
      await failImageJob(job.id, "provider_lost_request");
      return;
    case "error":
      await failImageJob(job.id, "provider_error", status.message);
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
    await noteUnreachable(job.id, result.message, "result");
    return;
  }
  if (result.kind === "error") {
    // A verdict, so the dependency answered and there are no bytes to come.
    await noteReachable(job.id, "result");
    await failImageJob(job.id, "provider_error", result.message);
    return;
  }
  // Deliberately *not* cleared here. Getting the image's address is half of
  // this dependency; fetching its bytes is the other half, and it is the half
  // that was failing. Clearing on the metadata read reset the clock of an
  // outage that had not ended, on every reconcile, so it could never run out.
  // {@link settleWithImage} clears it once the bytes are actually stored.
  //
  // Settled even when cancellation was requested: fal may accept a
  // cancellation and finish anyway, and an image we paid for should be kept.
  await settleWithImage(job.id, result.images[0]!.url);
}

/**
 * How long one outage may last before we stop waiting on a request.
 *
 * Bounds the outage, not the request. Measuring from submission meant a job
 * that had been queued for seven hours was written off by its very first
 * failed read, and a count of attempts was worse still: the browser polls
 * every three seconds and several readers can poll at once, so a twelve-
 * attempt budget could be spent inside a minute.
 */
const UNREACHABLE_GRACE_MS = 6 * 60 * 60 * 1000;

/**
 * Which dependency a read needed.
 *
 * These fail independently, so each keeps its own clock. `status` is the queue
 * status read, `result` the result fetch and image download, `authorization`
 * our own ownership lookup.
 */
type UnreachableSource = "status" | "result" | "authorization" | "storage";

/**
 * The column holding each dependency's outage start.
 *
 * `storage` deliberately shares `result`'s clock rather than owning one. This
 * dependency is "get the produced image into our hands and keep it", and the
 * two halves — fetching the bytes and writing them — are sequential steps of
 * one attempt that never overlap. `noteReachable("result")` is already only
 * called once the bytes are *stored*, not when their address is read, so the
 * clock already spans the write. Splitting it would need a column and a
 * migration to record nothing the shared clock does not already say.
 */
const OUTAGE_COLUMN = {
  status: "statusUnreachableSince",
  result: "resultUnreachableSince",
  authorization: "authUnreachableSince",
  storage: "resultUnreachableSince",
} as const satisfies Record<UnreachableSource, string>;

/**
 * How the reader is told which dependency let them down.
 *
 * `storage` is separate from `result` because the two failures are not the
 * same news. Telling someone the provider "produced an image we could not
 * fetch" when the fetch worked and our own store refused the write points them
 * at the wrong system.
 */
const OUTAGE_WORDING: Record<UnreachableSource, (hours: number) => string> = {
  status: (hours) =>
    `The provider could not be reached for this request for ${hours} hours`,
  result: (hours) =>
    `The provider produced an image we could not fetch for ${hours} hours`,
  authorization: (hours) =>
    `Could not confirm who this image belongs to for ${hours} hours`,
  storage: (hours) =>
    `The image was generated, but storing it has been failing for ${hours} hours`,
};

/**
 * The stable code a client localises, per dependency.
 *
 * `authorization` maps to no code on purpose. The other three are things a person
 * can be told in one clause; "we could not confirm who this image belongs to" is
 * not one of them, and the wording above already says it better than any code
 * would. Such a row keeps its sentence and leaves `failureReason` null, which a
 * client already has to handle for every job written before this existed.
 */
const OUTAGE_REASON: Record<UnreachableSource, ImageJobFailureReason | null> = {
  status: "provider_unreachable",
  result: "provider_unreachable",
  authorization: null,
  storage: "storage_unavailable",
};

/**
 * Record a read that never arrived, against the dependency that failed.
 *
 * Never settles the job on its own, and never touches the settlement lease —
 * it does not hold it. It gives up only once *this dependency's* outage has
 * run for {@link UNREACHABLE_GRACE_MS}, and even then the job stays
 * recoverable: {@link LIVE_STATUSES} keeps polling and settlement open to it.
 *
 * Per dependency because a shared clock reported the wrong thing twice over.
 * A newly failing dependency inherited the previous one's start time, so the
 * first failed provider read after a long authorization outage was announced
 * as a seven-hour provider outage.
 */
async function noteUnreachable(
  jobId: string,
  message: string,
  source: UnreachableSource = "status",
): Promise<void> {
  const now = new Date();
  const column = OUTAGE_COLUMN[source];
  const updated = await prisma.projectImageJob.update({
    where: { id: jobId },
    data: {
      polledAt: now,
      pollFailures: { increment: 1 },
      lastPollError: message.slice(0, 500),
      unreachableSource: source,
    },
    select: { [column]: true } as Record<string, true>,
  });

  const startedAt = (updated as Record<string, Date | null>)[column] ?? null;

  // First failure of this dependency's current run: start its clock and wait.
  if (!startedAt) {
    await prisma.projectImageJob.updateMany({
      where: { id: jobId, [column]: null },
      data: { [column]: now },
    });
    return;
  }

  const outageMs = now.getTime() - startedAt.getTime();
  if (outageMs < UNREACHABLE_GRACE_MS) return;

  const hours = Math.round(outageMs / 3_600_000);
  const reason = OUTAGE_REASON[source];
  await prisma.projectImageJob.updateMany({
    where: { id: jobId, status: { in: [...LIVE_STATUSES] } },
    data: {
      // Not FAILED: this request was sent and may have been billed, so
      // offering a retry that looks free would be a lie. Not terminal either —
      // this status stays pollable, so the image is still recoverable.
      status: ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
      // The raw dependency message stays out of it: the wording above already
      // says which dependency failed and for how long, which is the part a
      // person can act on. The detail is in `lastPollError` for whoever is
      // debugging the row.
      error: `${OUTAGE_WORDING[source](hours)}.`,
      ...(reason ? { failureReason: reason } : {}),
      settledAt: now,
    },
  });
}

/**
 * A read that got through ends *that dependency's* outage, and no other.
 *
 * A successful queue-status read used to clear the single shared clock, which
 * meant a continuing result or authorization failure had its elapsed time
 * reset on every ordinary reconcile and could never reach the grace period.
 *
 * "Got through" means the whole operation the clock covers, not its first
 * step. The `result` clock covers fetching the image's address *and*
 * downloading its bytes, so only a stored image ends it.
 */
async function noteReachable(
  jobId: string,
  source: UnreachableSource,
): Promise<void> {
  const column = OUTAGE_COLUMN[source];
  await prisma.projectImageJob.updateMany({
    where: { id: jobId, [column]: { not: null } },
    data: { [column]: null },
  });
}

/**
 * Settle a job on a definite answer from the provider, and pay it back.
 *
 * Only for verdicts: a runner error, a refused request, a request fal says it no
 * longer has. Never for a read that did not arrive — that is
 * {@link noteUnreachable}.
 *
 * Exported because it is the *only* place allowed to write a terminal failure on
 * an image job. fal's completion webhook used to write FAILED itself, with its
 * own `updateMany`, and so never refunded: a failed generation on preview took
 * eight credits and kept them. One owner is the fix — a second writer is a second
 * place that has to remember about money, and it did not.
 */
export async function failImageJob(
  jobId: string,
  reason: ImageJobFailureReason,
  /** The provider's own words. Logged, never shown. */
  providerDetail?: string,
): Promise<void> {
  if (providerDetail) {
    // Where a raw transport string belongs. "Unexpected status code: 422" is
    // useful to whoever is debugging the job and useless to whoever was waiting
    // for the image.
    console.warn("[image-studio] provider failed a generation", {
      jobId,
      reason,
      providerDetail: providerDetail.slice(0, 500),
    });
  }
  await prisma.projectImageJob.updateMany({
    where: {
      id: jobId,
      status: { in: [...LIVE_STATUSES] },
    },
    data: {
      status: ProjectImageJobStatus.FAILED,
      error: imageJobFailureMessage(reason),
      failureReason: reason,
      settledAt: new Date(),
    },
  });
  // Unconditional, and safe to be: the refund re-reads the row and does nothing
  // unless it is terminally failed and still holds a charge. Guarding on the
  // `updateMany` count instead would skip the job whose status another writer had
  // already set — the exact race the refund's own idempotency exists to handle.
  await refundImageJobCharge(jobId);
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
  // An uncertain job is still settleable. The callback that arrives after an
  // outage is exactly the case this has to accept, and it is the one the
  // webhook takes.
  if (!(LIVE_STATUSES as readonly string[]).includes(job.status)) {
    return;
  }

  // One settler does the paid work. A webhook, a page load and the cron can
  // all arrive together, and the unique index on `jobId` deduplicates the
  // *row* — but only after each of them has already downloaded the image and
  // written it to storage. The lease moves that deduplication in front of the
  // network, so the work happens once rather than being undone afterwards.
  const lease = await claimForSettlement(job.id);
  if (!lease) return;

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
    await noteReachable(job.id, "authorization");
  } catch (error) {
    if (!isAccessDenied(error)) {
      await releaseSettlementLease(job.id, lease);
      // We could not find out. That is not a refusal, and discarding a paid
      // image because a connection blipped is the worse of the two mistakes.
      // Leave the job live; a later reconcile or the cron will ask again.
      await noteUnreachable(
        job.id,
        error instanceof Error ? error.message : "access check unavailable",
        "authorization",
      );
      return;
    }
    // A real refusal: the project is gone, or the requester no longer has
    // access to it. Nothing is downloaded and nothing is stored.
    await releaseSettlementLease(job.id, lease);
    await prisma.projectImageJob.updateMany({
      where: { id: job.id },
      data: {
        status: ProjectImageJobStatus.ORPHANED,
        error: imageJobFailureMessage("access_revoked"),
        failureReason: "access_revoked",
        settledAt: new Date(),
      },
    });
    // The person keeps nothing, so they pay nothing — even though fal did produce
    // the image and did charge the platform for it. That cost belongs to whoever
    // revoked the access mid-flight, not to the person who asked for the image.
    await refundImageJobCharge(job.id);
    return;
  }

  // The studio's private store, and only it. A job can outlive the
  // configuration that started it — the token can be removed between
  // submission and settlement — so this is re-checked here rather than relying
  // on the guard in `createImageJob`. It fails the job instead of falling back
  // to the shared public store: an image nobody can see is recoverable, an
  // image published by accident is not.
  const studioBlobToken = readStudioBlobToken();
  if (!studioBlobToken) {
    console.error(
      "[image-studio] settlement deferred: IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN is not set, so the generated image has nowhere private to go.",
      { jobId: job.id },
    );
    await releaseSettlementLease(job.id, lease);
    // An outage, not a verdict. `failImageJob` was wrong here: fal has already
    // produced and charged for this image, and `FAILED` is outside
    // `LIVE_STATUSES`, so the row would drop out of `recoverableSelection()`
    // and neither polling nor the webhook could ever pick it up again —
    // putting the token back would not bring the image back. Worse, the UI
    // offers a plain "Try again" on a failed job with
    // `retryMayDuplicateCharge` false, inviting a second paid generation for
    // an image that already exists. Left live, the configuration can be fixed
    // and the next reconcile settles the image that was already paid for.
    await noteUnreachable(job.id, "image storage is not configured", "storage");
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
    await releaseSettlementLease(job.id, lease);
    await noteUnreachable(
      job.id,
      error instanceof Error ? error.message : "image download failed",
      "result",
    );
    return;
  }

  const checksum = crypto
    .createHash("sha256")
    .update(downloaded.bytes)
    .digest("hex");
  const dimensions = readPngDimensions(downloaded.bytes);

  // Private, and into the studio's own store — `studioBlobToken`, never
  // `BLOB_READ_WRITE_TOKEN`. Vercel fixes public-or-private per store, and the
  // shared platform store is public, so putting generated artwork there would
  // publish it: retrievable by URL, by anyone, with no credential. This store
  // is created with `--access private`, so the bytes are only readable by a
  // holder of this token — which lives on the server and is never sent to a
  // browser.
  //
  // The pathname is deliberately deterministic: a random suffix meant that
  // settlers racing the same job each wrote their own object, and the losers'
  // objects were left behind with nothing referencing them. One job, one
  // object, overwritten idempotently. That is an idempotency device, not a
  // secret, and nothing about access control rests on it.
  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put(
      `projects/${job.projectId}/image-studio/${job.id}-${checksum.slice(0, 16)}`,
      downloaded.bytes as unknown as Buffer,
      {
        access: "private",
        contentType: downloaded.contentType,
        token: studioBlobToken,
        addRandomSuffix: false,
        allowOverwrite: true,
        abortSignal: AbortSignal.timeout(60_000),
      },
    );
  } catch (error) {
    // The same reasoning as the download above, and the same treatment. This
    // was the one settlement step that let its failure escape: the lease
    // stayed held, nothing was recorded on the row, and the caller only logged
    // it — so a store that refuses every write showed as "Generating" with no
    // error and no end. Releasing and noting it keeps the job recoverable and
    // lets the outage clock eventually say so.
    await releaseSettlementLease(job.id, lease);
    // "storage", not "result": the download above succeeded, so the provider
    // did its part and it is our store that refused. Reporting this as a
    // result outage told the reader the provider "produced an image we could
    // not fetch", which points at the wrong system. Same clock either way —
    // see OUTAGE_COLUMN.
    await noteUnreachable(
      job.id,
      error instanceof Error ? error.message : "image storage write failed",
      "storage",
    );
    return;
  }

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
    await releaseSettlementLease(job.id, lease);
    throw error;
  }
  // The outage this dependency was in ends here, not earlier: publishing the
  // asset clears every clock in the same transaction that records the success.
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
        settleLeaseAt: null,
        settleLeaseOwner: null,
        // The job is done; no dependency is still owed a read.
        statusUnreachableSince: null,
        resultUnreachableSince: null,
        authUnreachableSince: null,
        unreachableSource: null,
      },
    });
  }, "Another image finished in this lineage at the same moment. Try again.");
}

/**
 * Statuses that mean the person got no image and must get their credits back.
 *
 * `SUBMISSION_UNCERTAIN` is deliberately absent, and that is the whole reason
 * this is a list rather than "not SUCCEEDED". We do not know whether fal
 * received that request, so we do not know whether it charged us — refunding it
 * automatically would hand back credits for images the platform paid for, and
 * every one of those rows stays recoverable and can still settle into a real
 * image. The existing recovery path owns them.
 */
const REFUNDABLE_STATUSES: ProjectImageJobStatus[] = [
  ProjectImageJobStatus.FAILED,
  ProjectImageJobStatus.CANCELED,
  ProjectImageJobStatus.ORPHANED,
];

/**
 * Give back what a failed generation was charged. Exactly once.
 *
 * A failed generation must not cost the person anything, and every terminal
 * failure path calls this. The hard part is "exactly once": a webhook, a page
 * load's reconcile and the cron sweep can all decide the same job has failed
 * within milliseconds of each other. The guard is `refundTransactionId`, read
 * and written inside one serializable transaction — the losing writer is aborted
 * by Postgres, retries, sees the refund and returns. The unique index on that
 * column is the backstop if the isolation level is ever relaxed.
 *
 * Never throws. A refund that could not be written leaves the column null, which
 * is precisely the state {@link refundFailedImageJobs} sweeps up, so the money
 * still comes back — a few minutes later instead of immediately. Throwing here
 * would abort a settlement that has already stored a paid-for image.
 */
export async function refundImageJobCharge(jobId: string): Promise<boolean> {
  try {
    return await serializableTransaction(async (tx) => {
      const job = await tx.projectImageJob.findUnique({
        where: { id: jobId },
        select: {
          id: true,
          status: true,
          chargedCents: true,
          refundTransactionId: true,
          transaction: {
            select: {
              id: true,
              userId: true,
              organizationId: true,
              amount: true,
            },
          },
        },
      });
      if (!job) return false;
      // Already paid back. The common case under a race, and not an error.
      if (job.refundTransactionId) return false;
      if (!REFUNDABLE_STATUSES.includes(job.status)) return false;
      // Nothing was taken: a job from before the studio charged, or a free one.
      if (!job.transaction || !job.chargedCents || job.chargedCents <= 0n) {
        return false;
      }
      const actorUserId = job.transaction.userId;
      if (!actorUserId) {
        // The debit records who spent; without it the refund has no pot to go to
        // and guessing one would credit the wrong person.
        console.error("[image-studio] refund skipped: spend has no userId", {
          jobId,
          transactionId: job.transaction.id,
        });
        return false;
      }

      await tx.projectImageJob.update({
        where: { id: job.id },
        data: {
          refundTransaction: {
            create: buildCompensatingRefundTransactionCreate({
              // The debit's own amount, negated, rather than `chargedCents`:
              // the ledger is the authority on what was actually taken.
              amount: job.transaction.amount * BigInt(-1),
              actorUserId,
              organizationId: job.transaction.organizationId,
              referenceId: job.id,
            }),
          },
        },
      });
      return true;
    }, "Another writer is refunding this image request. Try again.");
  } catch (error) {
    console.error("[image-studio] refund failed; the sweep will retry it", {
      jobId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return false;
  }
}

/**
 * The backstop: terminally failed jobs still holding a charge.
 *
 * Covers the inline refund that could not be written — a pool timeout, a
 * serialization failure that outlasted its retries, a process that died between
 * writing FAILED and refunding it. Without this, "a failed generation costs
 * nothing" would be true only when the happy path ran, which is not what a person
 * reading their balance is owed.
 */
export async function refundFailedImageJobs(limit: number): Promise<number> {
  const owed = await prisma.projectImageJob.findMany({
    where: {
      status: { in: REFUNDABLE_STATUSES },
      refundTransactionId: null,
      chargedCents: { gt: 0 },
      transactionId: { not: null },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let refunded = 0;
  for (const job of owed) {
    if (await refundImageJobCharge(job.id)) refunded += 1;
  }
  return refunded;
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
    where: { projectId, ...recoverableSelection() },
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
  refunded: number;
}> {
  const swept = await sweepStalledSubmissions();
  // The backstop for an inline refund that never got written. Runs before the
  // provider reads so a slow or failing fal cannot starve it.
  const refunded = await refundFailedImageJobs(options.limit);
  // Reservations whose process died before it reached fal. Provably unsent,
  // so finishing them costs nothing that was not already intended.
  const recovery = await recoverUnclaimedReservations();
  const cancelled = await finaliseCancellations(options.limit);
  const stale = await prisma.projectImageJob.findMany({
    where: {
      ...recoverableSelection(),
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
    refunded,
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
      status: { in: [...LIVE_STATUSES] },
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
          error: imageJobFailureMessage("cancelled"),
          failureReason: "cancelled",
        },
      });
      await refundImageJobCharge(job.id);
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
          error: imageJobFailureMessage("abandoned_before_send"),
          failureReason: "abandoned_before_send",
          settledAt: new Date(),
        },
      });
      // Provably unsent — `submitAttempts` is still zero — so the reservation's
      // debit is the only money involved and it comes straight back.
      await refundImageJobCharge(job.id);
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
          error: imageJobFailureMessage("access_revoked"),
          failureReason: "access_revoked",
          settledAt: new Date(),
        },
      });
      await refundImageJobCharge(job.id);
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
