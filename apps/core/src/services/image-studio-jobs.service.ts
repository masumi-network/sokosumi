import crypto from "node:crypto";
import {
  Prisma,
  ProjectImageJobKind,
  ProjectImageJobStatus,
  ProjectImageMediaType,
} from "@sokosumi/database";
import { creditBucketRepository } from "@sokosumi/database/repositories";
import {
  CORE_API_ERROR_KINDS,
  convertCentsToCredits,
  convertCreditsToCents,
  DEFAULT_VIDEO_SHAPE,
  readImageDimensionsFromBytes,
  SHORT_VIDEO_MAX_PICTURES,
  SHORT_VIDEO_TEXT_FORMATS,
  type ShortVideoFormat,
  talkingVideoQuotedSeconds,
  VIDEO_SHAPE_FRAMES,
  type VideoShape,
  videoRecipeFor,
  videoShapesFor,
} from "@sokosumi/utils";
import { put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";
import { LIMITS } from "@/config/constants";
import { getBetterAuthPublicBaseUrl } from "@/config/env";
import { DriveFileDownloadError } from "@/helpers/drive-file-download";
import {
  notFound,
  tooManyRequests,
  unprocessableEntity,
} from "@/helpers/error";
import { jsonInput } from "@/helpers/prisma-json";
import {
  createTaskEventTransaction,
  isInsufficientBalanceError,
} from "@/helpers/task-credits";
import { DATA_ROOM_PEOPLE_KINDS } from "@/lib/data-room-visibility";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import { driveHead, driveReadUrl } from "@/lib/drive-blob";
import {
  emitCoreWarning,
  recordCoreError,
  recordCoreWarning,
  runAsBackgroundWork,
} from "@/lib/evlog";
import type { FileActor } from "@/lib/files/actor";
import {
  type ProjectAccess,
  requireProjectAccess,
  requireProjectAccessForUser,
} from "@/lib/image-studio/access";
import {
  readStudioBlobToken,
  requireStudioBlobToken,
} from "@/lib/image-studio/blob-store";
import { imageModel, resolveImageSettings } from "@/lib/image-studio/catalog";
import { RECRAFT_VECTOR_ENDPOINT } from "@/lib/image-studio/catalog-overrides";
import {
  type ImageJobFailureReason,
  imageJobFailureMessage,
} from "@/lib/image-studio/failure-reason";
import {
  buildFalInput,
  cancelQueued,
  downloadMedia,
  type FalMedia,
  falModelForKind,
  falModelForLettering,
  fetchQueueResult,
  fetchQueueStatus,
  submitToQueue,
  uploadReference,
} from "@/lib/image-studio/fal-client";
import { renderHeadlineMask } from "@/lib/image-studio/headline-mask";
import { creditsPerImage } from "@/lib/image-studio/image-model";
import {
  composeStudioProductCutout,
  validateStudioProductCutout,
} from "@/lib/image-studio/product-cutout";
import { requireStudioReferenceFiles } from "@/lib/image-studio/reference-files";
import {
  applyStudioBrandPrompt,
  buildStudioLetteringPrompt,
  isApprovedStudioHeadline,
  loadStudioBrand,
  readStudioBrandKit,
  requireApprovedStudioHeadline,
  STUDIO_PROMPT_ASSEMBLY_VERSION,
  studioBrandPromptBlock,
} from "@/lib/image-studio/studio-brand";
import {
  buildTalkingVideoBrollInput,
  buildTalkingVideoCaptionInput,
  buildTalkingVideoCutoutInput,
  buildTalkingVideoInput,
  buildTalkingVideoMusicInput,
  creditsPerShortVideo,
  creditsPerTalkingVideo,
  findTalkingVideoPresenter,
  fitVideoPicture,
  frameTalkingVideoPresenter,
  keepVideoPicture,
  posesAsCustomerTestimonial,
  readTalkingVideoSettings,
  TALKING_VIDEO_BROLL_ENDPOINT,
  TALKING_VIDEO_CAPTION_ENDPOINT,
  TALKING_VIDEO_CUTOUT_ENDPOINT,
  TALKING_VIDEO_MUSIC_ENDPOINT,
  TALKING_VIDEO_RESOLUTION,
  TALKING_VIDEO_TESTIMONIAL_MESSAGE,
  type TalkingVideoModel,
  type TalkingVideoSettings,
  talkingVideoModel,
  talkingVideoModelForEndpoint,
} from "@/lib/image-studio/talking-video";
import {
  captureTalkingVideoSitePage,
  loadTalkingVideoEndCard,
} from "@/lib/image-studio/talking-video-brand";
import {
  editShortVideo,
  editTalkingVideo,
  hookTakesBroll,
  readingTimings,
  type SpokenWord,
} from "@/lib/image-studio/talking-video-edit";
import { timeSpokenWords } from "@/lib/image-studio/talking-video-words";
import {
  findVideoModelForEndpoint,
  videoModel,
} from "@/lib/image-studio/video-catalog";
import {
  buildFalVideoInput,
  creditsPerVideo,
  defaultVideoSettings,
  type VideoModel,
  type VideoSettings,
  validateVideoSettings,
} from "@/lib/image-studio/video-model";
import { layoutBlockMap } from "@/lib/reference-library/layout";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { speakVoiceover } from "@/lib/soko-bot/voiceover";
import {
  type ImageStudioRoute,
  readImageStudioRoute,
  readStudioRouterArm,
  type StudioRouterArm,
} from "@/schemas/image-studio-route.schema";
import type { StudioProductIdentity } from "@/schemas/studio-product.schema";
import { enqueueAdEval } from "@/services/ad-eval.service";
import { readAssetBytes } from "@/services/image-studio-assets.service";
import { publishStudioAssetToFiles } from "@/services/image-studio-drive.service";
import { recordStudioAdEvent } from "@/services/image-studio-events.service";
import { readReferenceImage } from "@/services/reference-library.service";
import {
  writeTalkingVideoBrollPrompt,
  writeTalkingVideoHookLine,
} from "@/services/talking-video-scripts.service";
import { unsafeSvgReason } from "./soko-bot-svg";

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

/** The idempotency key of a shape cut from another job: `video-shape:<source>:<shape>`. */
const VIDEO_SHAPE_KEY_PREFIX = "video-shape";

const SPEND_WINDOW_MS = 60 * 60 * 1000;
/** The start of every job key a Cuso's month makes (`cmo-media-maker`). */
export const CMO_MONTH_JOB_KEY_PREFIX = "cmo-media";

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
  route?: ImageStudioRoute;
  experimentArm?: StudioRouterArm;
  modelId?: string;
  /**
   * Core's month media (cmo-media-maker): its own limit at a time and no
   * hourly cap, because the approved plan already bounds how many it makes.
   * Never set from a request.
   */
  forCmoMonth?: boolean;
  projectId: string;
  workspaceId: string;
  userId: string;
  sessionId: string | null;
  prompt: string;
  product?: StudioProductIdentity;
  batchId?: string;
  templateId?: string;
  creativeDirection?: string;
  variationIndex?: number;
  /** Continue the same campaign ad when the request edits one source image. */
  reuseParentBatchSlot?: boolean;
  exportHeadline?: string;
  lettering?: "overlay" | "ideogram";
  useProductCutout?: boolean;
  /** Refine a source backdrop and reapply its original product photo. */
  reuseParentCutout?: boolean;
  settings: ImageJobSettings;
  /** Assets whose bytes become references. Empty means text-to-image. */
  referenceAssetIds: string[];
  /**
   * Files in this workspace sent as references after the assets: a brand's
   * product photos. The caller checks the person may open them.
   */
  referenceFileIds?: string[];
  /** The REST caller, whose file access must be checked for new requests. */
  referenceFileActor?: FileActor;
  /**
   * Reference library images sent first, as the style to borrow. Core only:
   * Cuso's media maker sets them, no route does.
   */
  referenceLibraryIds?: string[];
  /**
   * Send the reference library image as a block map of its layout only
   * (cmo-v11): the picture borrows where things sit, not the print's look.
   */
  styleLayoutOnly?: boolean;
  /**
   * How many of the Project's month jobs may run at once; Core's media maker
   * raises it for a version that makes several alternatives per picture.
   */
  monthConcurrency?: number;
  /** Keep the source ad's product photo when an assistant edit can use it. */
  reuseParentPhotoIfAvailable?: boolean;
  /** Keep a source ad's currently approved headline on a visual refinement. */
  reuseParentHeadlineIfAvailable?: boolean;
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
interface ReserveImageJobInput
  extends Omit<CreateImageJobInput, "settings" | "modelId"> {
  kind: ProjectImageJobKind;
  /** The provider endpoint the job is sent to. */
  model: string;
  settings: ImageJobSettings | VideoSettings;
  /** Null for a personal workspace; otherwise the pot being charged. */
  organizationId: string | null;
  /** Credits (= cents) to debit for this one image. */
  chargedCredits: number;
  letteringQuoteCents?: bigint;
  letteringSettings?: ImageJobSettings;
  letteringModel?: string;
  presenterConsentAt?: Date;
}

/**
 * Reserve a job row, or hand back the one this key already made.
 *
 * Counting the in-flight jobs, taking the credits, and inserting the new row all
 * have to be the same operation. As separate statements, concurrent submissions
 * all read the same count, all pass the limit, and each then buys an image — the
 * cap would bound a serial loop and not a burst. And a debit outside the insert
 * is a charge with no job to point at, or a job nobody paid for, depending on
 * which half failed.
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

/**
 * Refuse a submission the balance cannot cover, without taking anything.
 *
 * Read-only by design. The studio charges on delivery, so there is nothing to
 * reserve here — but a person should still be told "not enough credits" before a
 * provider call rather than after one, and they should not be able to queue five
 * images they can only afford one of.
 *
 * Hence the aggregate: the balance has to cover this image **plus every quote this
 * person already has in flight**. Checking this image alone would let three
 * concurrent submissions each see a balance that covers one of them, and the debits
 * would then collide at delivery. This is not a reservation — it writes nothing and
 * holds nothing — it just closes almost all of that window in one read.
 *
 * "Almost" is honest: two submissions can still pass this check in parallel and both
 * land. What that costs is bounded and known, because `prepareConsumption` cannot
 * overdraw — the balance can never go negative. The loser is handled at delivery,
 * where the image is kept and given away free rather than lost. See `insertAsset`.
 */
async function requireBalanceForQuote(options: {
  userId: string;
  organizationId: string | null;
  /** The job's Project: the balance its delivery will charge (ADR 0067). */
  projectId: string;
  chargedCents: bigint;
  tx: Prisma.TransactionClient;
}): Promise<void> {
  if (options.chargedCents <= 0n) return;

  // shortcut: in-flight sums the requester's pending jobs across all Projects, so it can only refuse too often, never overspend; scope it per Project when pending images in two scoped Projects get refused.
  const committed = await options.tx.projectImageJob.aggregate({
    where: {
      requestedByUserId: options.userId,
      status: { in: ACTIVE_STATUSES },
    },
    _sum: { chargedCents: true, letteringQuoteCents: true },
  });
  const inFlight =
    (committed._sum.chargedCents ?? 0n) +
    (committed._sum.letteringQuoteCents ?? 0n);
  const balance = await creditBucketRepository.getBalance(
    options.userId,
    options.organizationId,
    options.tx,
    { projectId: options.projectId },
  );
  const required = inFlight + options.chargedCents;
  if (balance >= required) return;

  // Credits, not cents, and the studio's own register — the repository's own
  // message is about bucket arithmetic and is no use to the person reading it.
  const price = convertCentsToCredits(options.chargedCents);
  const available = convertCentsToCredits(balance);
  throw unprocessableEntity(
    inFlight > 0n
      ? `Not enough credits. This image costs ${price}, your balance is ${available}, and ${convertCentsToCredits(inFlight)} is already committed to images still generating.`
      : `Not enough credits. This image costs ${price} and your balance is ${available}.`,
    { kind: CORE_API_ERROR_KINDS.INSUFFICIENT_BALANCE },
  );
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

    const source =
      input.parentAssetId &&
      (!input.product ||
        input.reuseParentHeadlineIfAvailable ||
        input.reuseParentBatchSlot ||
        input.reuseParentCutout)
        ? await tx.projectImageAsset.findFirst({
            where: { id: input.parentAssetId, projectId: input.projectId },
            select: {
              ...(input.reuseParentHeadlineIfAvailable
                ? { headline: { select: { text: true } } }
                : {}),
              ...(input.reuseParentCutout
                ? { backdropBlobPathname: true, backdropContentType: true }
                : {}),
              job: {
                select: {
                  productId: true,
                  productName: true,
                  referenceFileIds: true,
                  ...(input.reuseParentCutout
                    ? { useProductCutout: true, productCutoutChecksum: true }
                    : {}),
                  ...(input.reuseParentBatchSlot
                    ? { id: true, batchId: true, batchSlotId: true }
                    : {}),
                },
              },
            },
          })
        : null;

    const batchSlotId =
      source?.job.batchSlotId ??
      (source?.job.batchId ? source.job.id : undefined);
    const sameProduct = input.product
      ? input.product.id === source?.job.productId
      : !input.referenceFileIds?.length;
    const inheritedHeadline = sameProduct ? source?.headline?.text : undefined;
    let exportHeadline = input.exportHeadline;
    if (exportHeadline || inheritedHeadline) {
      const brand = await tx.brandBrain.findUnique({
        where: { projectId: input.projectId },
        select: { body: true },
      });
      if (exportHeadline)
        requireApprovedStudioHeadline(exportHeadline, brand?.body);
      else if (
        inheritedHeadline &&
        isApprovedStudioHeadline(inheritedHeadline, brand?.body)
      ) {
        exportHeadline = inheritedHeadline;
      }
    }

    const referenceCount =
      input.referenceAssetIds.length + (input.referenceFileIds?.length ?? 0);
    if (
      input.referenceFileActor &&
      referenceCount > LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB
    ) {
      throw unprocessableEntity(
        `Choose up to ${LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB} reference images.`,
      );
    }

    if (input.referenceFileActor && input.referenceFileIds?.length) {
      await requireStudioReferenceFiles(
        {
          workspaceId: input.workspaceId,
          actor: input.referenceFileActor,
          resourceIds: input.referenceFileIds,
        },
        tx,
      );
    }

    let referenceFileIds = input.referenceFileIds ?? [];
    const inheritsCutout =
      input.reuseParentCutout && sameProduct && source?.job.useProductCutout;
    if (inheritsCutout) {
      if (
        !source?.backdropBlobPathname ||
        !source.backdropContentType ||
        !source.job.productCutoutChecksum ||
        source.job.referenceFileIds.length !== 1 ||
        !input.referenceFileActor
      ) {
        throw unprocessableEntity(
          "This ad has no saved backdrop to refine. Create a new ad with the original product photo first.",
        );
      }
      referenceFileIds = source.job.referenceFileIds;
      await requireStudioReferenceFiles(
        {
          workspaceId: input.workspaceId,
          actor: input.referenceFileActor,
          resourceIds: referenceFileIds,
        },
        tx,
      );
    }
    const inheritedPhotoId = input.reuseParentPhotoIfAvailable
      ? source?.job.referenceFileIds.at(-1)
      : undefined;
    if (!inheritsCutout && inheritedPhotoId && input.referenceFileActor) {
      try {
        await requireStudioReferenceFiles(
          {
            workspaceId: input.workspaceId,
            actor: input.referenceFileActor,
            resourceIds: [inheritedPhotoId],
          },
          tx,
        );
        referenceFileIds = [inheritedPhotoId];
      } catch (error) {
        if (
          !(error instanceof HTTPException) ||
          (error.status !== 404 && error.status !== 422)
        ) {
          throw error;
        }
      }
    }

    // Another shape of a delivered video costs nothing and asks no provider,
    // so it holds none of the project's slots and none of the hourly ones.
    const inFlight = await tx.projectImageJob.count({
      where: {
        projectId: input.projectId,
        status: { in: ACTIVE_STATUSES },
        NOT: { idempotencyKey: { startsWith: `${VIDEO_SHAPE_KEY_PREFIX}:` } },
      },
    });
    const atOnce = input.forCmoMonth
      ? (input.monthConcurrency ?? LIMITS.CMO_MONTH_CONCURRENT_JOBS_PER_PROJECT)
      : LIMITS.IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT;
    if (inFlight >= atOnce) {
      throw tooManyRequests(
        `This project already has ${atOnce} images being generated. Wait for one to finish.`,
        { kind: "image_studio_project_busy" },
      );
    }

    // A Cuso's month makes its pictures under the owner's name: they never
    // count against the picture the owner asks for in chat.
    const recent = input.forCmoMonth
      ? 0
      : await tx.projectImageJob.count({
          where: {
            requestedByUserId: input.userId,
            createdAt: { gte: new Date(Date.now() - SPEND_WINDOW_MS) },
            NOT: [
              {
                idempotencyKey: { startsWith: `${CMO_MONTH_JOB_KEY_PREFIX}:` },
              },
              { idempotencyKey: { startsWith: `${VIDEO_SHAPE_KEY_PREFIX}:` } },
            ],
          },
        });
    if (recent >= LIMITS.IMAGE_STUDIO_GENERATIONS_PER_USER_PER_HOUR) {
      throw tooManyRequests(
        `You can start at most ${LIMITS.IMAGE_STUDIO_GENERATIONS_PER_USER_PER_HOUR} image generations per hour.`,
        { kind: "image_studio_rate_limited" },
      );
    }

    // A quote, not a charge. The studio charges when it delivers an image, so this
    // transaction takes no money and writes no consumption rows — `insertAsset` is
    // the only place a debit happens.
    const chargedCents = convertCreditsToCents(input.chargedCredits);
    await requireBalanceForQuote({
      userId: input.userId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      chargedCents: chargedCents + (input.letteringQuoteCents ?? 0n),
      tx,
    });

    // A unique violation here aborts this transaction. It is caught by the
    // caller, on a fresh connection, because the aborted one cannot answer
    // another query.
    const productId = input.product?.id ?? source?.job.productId;
    const productName = input.product?.name ?? source?.job.productName;
    const useProductCutout = inheritsCutout || input.useProductCutout;
    const productCutoutChecksum = inheritsCutout
      ? source?.job.productCutoutChecksum
      : undefined;
    const job = await tx.projectImageJob.create({
      data: {
        projectId: input.projectId,
        workspaceId: input.workspaceId,
        sessionId: input.sessionId,
        requestedByUserId: input.userId,
        kind: input.kind,
        model: input.model,
        prompt: input.prompt,
        ...(productId !== undefined ? { productId } : {}),
        ...(productName !== undefined ? { productName } : {}),
        ...(input.batchId !== undefined ? { batchId: input.batchId } : {}),
        ...(input.templateId !== undefined
          ? { templateId: input.templateId }
          : {}),
        ...(input.creativeDirection !== undefined
          ? { creativeDirection: input.creativeDirection }
          : {}),
        ...(input.variationIndex !== undefined
          ? { variationIndex: input.variationIndex }
          : {}),
        ...(batchSlotId !== undefined ? { batchSlotId } : {}),
        ...(exportHeadline !== undefined ? { exportHeadline } : {}),
        lettering: input.lettering ?? (exportHeadline ? "ideogram" : "overlay"),
        ...(input.letteringQuoteCents !== undefined
          ? { letteringQuoteCents: input.letteringQuoteCents }
          : {}),
        ...(input.presenterConsentAt !== undefined
          ? { presenterConsentAt: input.presenterConsentAt }
          : {}),
        ...(useProductCutout !== undefined ? { useProductCutout } : {}),
        ...(productCutoutChecksum !== undefined
          ? { productCutoutChecksum }
          : {}),
        settings: jsonInput({
          ...input.settings,
          ...(input.route && { route: input.route }),
          ...(input.experimentArm && { experimentArm: input.experimentArm }),
          ...(input.letteringSettings
            ? {
                letteringSettings: { ...input.letteringSettings },
                ...(input.letteringModel !== undefined
                  ? { letteringModel: input.letteringModel }
                  : {}),
              }
            : {}),
        }),
        referenceAssetIds: input.referenceAssetIds,
        referenceFileIds,
        referenceLibraryIds: input.referenceLibraryIds ?? [],
        styleLayoutOnly: input.styleLayoutOnly ?? false,
        parentAssetId: input.parentAssetId,
        idempotencyKey: input.idempotencyKey,
        status: ProjectImageJobStatus.PENDING,
        // The price the person was shown, kept so the figure taken at delivery is
        // the figure they agreed to even if the catalog refreshes in between.
        // `transactionId` stays null until there is an image to charge for.
        chargedCents,
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

/** The idempotency key of a shape cut from another job. */
export function videoShapeJobKey(sourceJobId: string, shape: VideoShape) {
  return `${VIDEO_SHAPE_KEY_PREFIX}:${sourceJobId}:${shape}`;
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
  } satisfies Prisma.ProjectImageJobWhereInput;
}

/**
 * Shapes cut from a delivered video wait here. They ask no provider, so they
 * have their own slot in a reconcile pass, and only one: each edit takes up
 * to a settlement's whole time, and a pass that ran several would outlast
 * the request that runs it.
 */
function videoShapeSelection() {
  return {
    status: { in: [...LIVE_STATUSES] },
    falRequestId: null,
    idempotencyKey: { startsWith: `${VIDEO_SHAPE_KEY_PREFIX}:` },
  } satisfies Prisma.ProjectImageJobWhereInput;
}

/** The oldest shape waiting to be cut, as one more job for a reconcile pass. */
async function nextVideoShape(
  where: Prisma.ProjectImageJobWhereInput,
  orderBy: Prisma.ProjectImageJobOrderByWithRelationInput,
): Promise<{ id: string }[]> {
  const shape = await prisma.projectImageJob.findFirst({
    where: { ...where, ...videoShapeSelection() },
    orderBy,
    select: { id: true },
  });
  return shape ? [shape] : [];
}

/** A video cut in another shape from a delivered job's parts. */
function isVideoShapeJob(job: {
  kind: ProjectImageJobKind;
  falRequestId: string | null;
  idempotencyKey: string;
}): boolean {
  return (
    job.kind === ProjectImageJobKind.TALKING_VIDEO &&
    !job.falRequestId &&
    job.idempotencyKey.startsWith(`${VIDEO_SHAPE_KEY_PREFIX}:`)
  );
}

/**
 * Take the exclusive right to settle this job.
 *
 * Reuses `submitLeaseAt`: a job being settled is past submission, so the field
 * is free, and one conditional UPDATE is all the mutual exclusion this needs.
 * A settler that dies leaves the lease behind; the deadline is what lets the
 * next one through.
 */
async function claimForSettlement(
  jobId: string,
  /** Claim only while the job still waits on this provider request. */
  falRequestId?: string,
): Promise<string | null> {
  const owner = crypto.randomUUID();
  const deadline = new Date(Date.now() - SETTLE_LEASE_MS);
  const claimed = await prisma.projectImageJob.updateMany({
    where: {
      id: jobId,
      ...(falRequestId !== undefined ? { falRequestId } : {}),
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
async function buildReferenceUrls(
  job: {
    projectId: string;
    workspaceId: string;
    requestedByUserId: string;
    idempotencyKey: string;
    referenceAssetIds: string[];
    referenceFileIds: string[];
    referenceLibraryIds?: string[];
    styleLayoutOnly?: boolean;
    useProductCutout?: boolean;
  },
  organizationId: string | null,
): Promise<string[]> {
  const providerFileIds = job.useProductCutout ? [] : job.referenceFileIds;
  const libraryIds = job.referenceLibraryIds ?? [];
  const count =
    libraryIds.length + job.referenceAssetIds.length + providerFileIds.length;
  if (count === 0) return [];
  if (count > LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB) {
    throw unprocessableEntity(
      `At most ${LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB} reference images are allowed.`,
    );
  }
  const assets =
    job.referenceAssetIds.length === 0
      ? []
      : await prisma.projectImageAsset.findMany({
          where: {
            id: { in: job.referenceAssetIds },
            projectId: job.projectId,
          },
          select: {
            id: true,
            blobPathname: true,
            contentType: true,
            bytes: true,
            ...(job.useProductCutout
              ? { backdropBlobPathname: true, backdropContentType: true }
              : {}),
          },
        });
  if (assets.length !== job.referenceAssetIds.length) {
    throw notFound("A reference image was not found in this project");
  }

  const urls: string[] = [];
  // The style reference goes first: the prompt names it as the first image.
  for (const id of libraryIds) {
    const reference = await readReferenceImage(id);
    if (!reference) throw notFound("A style reference was not found.");
    urls.push(
      await uploadReference(
        job.styleLayoutOnly
          ? {
              bytes: await layoutBlockMap(reference.bytes),
              contentType: "image/png",
              fileName: `layout-${id}.png`,
            }
          : {
              bytes: reference.bytes,
              contentType: reference.contentType,
              fileName: `style-${id}.${reference.contentType.split("/")[1] ?? "jpg"}`,
            },
      ),
    );
  }
  // Order matters to the model, so follow the caller's order rather than the
  // order the database happened to return.
  for (const assetId of job.referenceAssetIds) {
    const asset = assets.find((candidate) => candidate.id === assetId);
    if (!asset)
      throw notFound("A reference image was not found in this project");
    const pathname = job.useProductCutout
      ? asset.backdropBlobPathname
      : asset.blobPathname;
    const contentType = job.useProductCutout
      ? asset.backdropContentType
      : asset.contentType;
    if (!pathname || !contentType)
      throw notFound("This ad's original backdrop is unavailable.");
    if (
      !job.useProductCutout &&
      asset.bytes > LIMITS.IMAGE_STUDIO_MAX_REFERENCE_BYTES
    )
      throw unprocessableEntity("A reference image is too large to send.");
    const bytes = await readAssetBytes(pathname);
    if (bytes.byteLength > LIMITS.IMAGE_STUDIO_MAX_REFERENCE_BYTES)
      throw unprocessableEntity("A reference image is too large to send.");
    urls.push(
      await uploadReference({
        bytes,
        contentType,
        fileName: `${asset.id}.${contentType.split("/")[1] ?? "png"}`,
      }),
    );
  }
  for (const fileId of providerFileIds) {
    urls.push(
      await uploadFileReference(
        job.workspaceId,
        fileId,
        {
          userId: job.requestedByUserId,
          organizationId,
          kind: automatedRequestKind(job.idempotencyKey),
        },
        // A styled picture's logo is often a transparent PNG, which a model
        // can read as a black square.
        libraryIds.length > 0,
      ),
    );
  }
  return urls;
}

/** A workspace image File, sent to fal the way an asset reference is. */
async function uploadFileReference(
  workspaceId: string,
  fileId: string,
  actor: FileActor,
  onPaper = false,
): Promise<string> {
  const { bytes, mimeType } = await downloadStudioFileReference(
    workspaceId,
    fileId,
    actor,
  );
  if (onPaper && mimeType === "image/png")
    return await uploadReference({
      bytes: await sharp(bytes)
        .flatten({ background: "#ffffff" })
        .png()
        .toBuffer(),
      contentType: "image/png",
      fileName: `${fileId}.png`,
    });
  return await uploadReference({
    bytes,
    contentType: mimeType,
    fileName: `${fileId}.${mimeType.split("/")[1] ?? "png"}`,
  });
}

export async function downloadStudioFileReference(
  workspaceId: string,
  fileId: string,
  actor: FileActor,
) {
  // The requester can lose access to a private room while the reservation is
  // pending. Resolve the current, authorized pathname before opening the file.
  const [sourceId] = await requireStudioReferenceFiles({
    workspaceId,
    actor,
    resourceIds: [fileId],
  });
  if (!sourceId)
    throw notFound("A reference image was not found in your Files.");
  const blob = await driveHead(sourceId);
  if (!blob) throw new DriveFileDownloadError("unavailable");
  if (blob.size > LIMITS.IMAGE_STUDIO_MAX_REFERENCE_BYTES)
    throw new DriveFileDownloadError("too_large");
  // A data room's picture is private: a short-lived signed address instead.
  const url =
    blob.access === "public" ? blob.url : await driveReadUrl(sourceId);
  // The address comes from our own blob store, never from a person, so it
  // needs no SSRF guard; and the store's bot check answered the guarded
  // client 403 after its first request, failing every brand picture after
  // the first.
  const download = async () => {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new DriveFileDownloadError("unavailable");
    const mimeType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase();
    if (!mimeType?.startsWith("image/"))
      throw new DriveFileDownloadError("wrong_type");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > LIMITS.IMAGE_STUDIO_MAX_REFERENCE_BYTES)
      throw new DriveFileDownloadError("too_large");
    return { bytes, mimeType };
  };
  // One retry: a live test once got a passing error status for a stored
  // photo, and nothing is charged before the job is sent.
  return await download().catch(async (error) => {
    if (!(error instanceof DriveFileDownloadError)) throw error;
    if (error.reason !== "unavailable") throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return await download();
  });
}

async function readProductCutout(
  job: {
    workspaceId: string;
    requestedByUserId: string;
    referenceFileIds: string[];
  },
  organizationId: string | null,
) {
  const fileId = job.referenceFileIds[0];
  if (!fileId)
    throw unprocessableEntity("Choose a transparent PNG product photo.");
  const { bytes } = await downloadStudioFileReference(job.workspaceId, fileId, {
    kind: "interactive",
    userId: job.requestedByUserId,
    organizationId,
  });
  await validateStudioProductCutout(bytes);
  return {
    bytes,
    checksum: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
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

  if (
    input.useProductCutout &&
    (!isUserFileActor(input.referenceFileActor) ||
      input.referenceFileIds?.length !== 1 ||
      input.referenceAssetIds.length !== 0 ||
      input.parentAssetId !== null)
  ) {
    throw unprocessableEntity(
      "Choose one transparent PNG product photo to create a new ad with the original product.",
    );
  }
  const lettering =
    input.lettering ?? (input.exportHeadline ? "ideogram" : "overlay");
  if (lettering === "ideogram" && !input.exportHeadline) {
    throw unprocessableEntity(
      "Choose an approved headline for Ideogram lettering.",
    );
  }
  const startsLettering =
    lettering === "ideogram" && input.modelId !== "ideogram-v3";
  const requestedModelId = startsLettering ? "gemini-pro" : input.modelId;
  // A library style is a reference too: without it the job takes the model's
  // generate endpoint, which refuses the reference it is then sent.
  const references =
    input.referenceAssetIds.length +
    (input.referenceLibraryIds?.length ?? 0) +
    (input.useProductCutout ? 0 : (input.referenceFileIds?.length ?? 0));
  let settings: ImageJobSettings;
  try {
    settings = resolveImageSettings(
      requestedModelId,
      input.settings,
      references,
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
  let maxReferences: number;
  let letteringSettings: ImageJobSettings | undefined;
  let letteringModel: string | undefined;
  let letteringQuoteCents: bigint | undefined;
  try {
    const model = imageModel(requestedModelId);
    chargedCredits = creditsPerImage(model, settings);
    if (startsLettering) {
      letteringSettings = resolveImageSettings("ideogram-v3", settings, 1);
      letteringQuoteCents = convertCreditsToCents(
        creditsPerImage(imageModel("ideogram-v3"), letteringSettings),
      );
      letteringModel = falModelForLettering("ideogram-v3");
    } else if (
      lettering === "ideogram" &&
      (references !== 1 || input.useProductCutout)
    ) {
      throw new Error(
        "Ideogram lettering needs one delivered image reference.",
      );
    }
    maxReferences = Math.min(
      model.maxReferences,
      LIMITS.IMAGE_STUDIO_MAX_REFERENCES_PER_JOB,
    );
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid image settings",
      { kind: "invalid_image_settings" },
    );
  }

  const kind =
    references > 0 ? ProjectImageJobKind.EDIT : ProjectImageJobKind.GENERATE;
  const { modelId: _modelId, ...request } = input;
  const refinesParent =
    input.parentAssetId !== null &&
    input.referenceAssetIds.includes(input.parentAssetId);
  const refinesSingleSource =
    refinesParent && input.referenceAssetIds.length === 1;
  return await reserveAndSend({
    ...request,
    reuseParentPhotoIfAvailable:
      (lettering !== "ideogram" || startsLettering) &&
      input.reuseParentPhotoIfAvailable &&
      !input.product &&
      !input.referenceFileIds?.length &&
      refinesParent &&
      references < maxReferences,
    reuseParentHeadlineIfAvailable:
      input.reuseParentHeadlineIfAvailable && refinesSingleSource,
    reuseParentBatchSlot:
      input.reuseParentBatchSlot && !input.batchId && refinesSingleSource,
    reuseParentCutout:
      (lettering !== "ideogram" || startsLettering) &&
      input.reuseParentCutout &&
      isUserFileActor(input.referenceFileActor) &&
      !input.referenceFileIds?.length &&
      refinesSingleSource,
    kind,
    model: falModelForKind(kind, requestedModelId),
    lettering,
    letteringSettings,
    letteringModel,
    letteringQuoteCents,
    settings,
    organizationId: access.organizationId,
    chargedCredits,
  });
}

export interface CreateVideoJobInput {
  modelId?: string;
  /**
   * Core's month media (cmo-media-maker): its own limit at a time and no
   * hourly cap, because the approved plan already bounds how many it makes.
   * Never set from a request.
   */
  forCmoMonth?: boolean;
  projectId: string;
  workspaceId: string;
  userId: string;
  sessionId: string | null;
  prompt: string;
  /** Missing fields take the model's defaults. */
  settings: Partial<VideoSettings>;
  /** A gallery image to animate. Null makes a video from the prompt alone. */
  sourceAssetId: string | null;
  idempotencyKey: string;
}

/**
 * Create (or replay) a video job and, when this caller owns the lease, send it.
 *
 * The same row, lease, quote, webhook and settlement as an image: a video is one
 * more thing the studio buys from fal, so it takes the same fences against
 * buying it twice and the same charge-on-delivery.
 */
export async function createVideoJob(input: CreateVideoJobInput) {
  const access = await requireProjectAccess({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  requireStudioBlobToken();

  const hasSource = input.sourceAssetId !== null;
  let model: VideoModel;
  let settings: VideoSettings;
  let chargedCredits: number;
  try {
    model = videoModel(input.modelId, hasSource ? "image" : "text");
    settings = validateVideoSettings(
      model,
      { ...defaultVideoSettings(model), ...input.settings },
      hasSource,
    );
    chargedCredits = creditsPerVideo(model, settings);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid video settings",
      { kind: "invalid_video_settings" },
    );
  }

  let product: StudioProductIdentity | undefined;
  if (input.sourceAssetId) {
    const source = await prisma.projectImageAsset.findFirst({
      where: { id: input.sourceAssetId, projectId: input.projectId },
      select: {
        mediaType: true,
        job: { select: { productId: true, productName: true } },
      },
    });
    if (!source) throw notFound("The image to animate was not found");
    if (source.mediaType !== ProjectImageMediaType.IMAGE)
      throw unprocessableEntity("Only an image can be animated.", {
        kind: "invalid_video_settings",
      });
    const { productId, productName } = source.job;
    if (productId && productName) {
      product = { id: productId, name: productName };
    }
  }

  return await reserveAndSend({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    sessionId: input.sessionId,
    prompt: input.prompt,
    product,
    idempotencyKey: input.idempotencyKey,
    forCmoMonth: input.forCmoMonth,
    kind: hasSource
      ? ProjectImageJobKind.IMAGE_TO_VIDEO
      : ProjectImageJobKind.TEXT_TO_VIDEO,
    model: model.endpoint,
    settings,
    referenceAssetIds: input.sourceAssetId ? [input.sourceAssetId] : [],
    parentAssetId: null,
    organizationId: access.organizationId,
    chargedCredits,
  });
}

export interface CreateTalkingVideoJobInput {
  modelId?: string;
  /**
   * Core's month media (cmo-media-maker): its own limit at a time and no
   * hourly cap, because the approved plan already bounds how many it makes.
   * Never set from a request.
   */
  forCmoMonth?: boolean;
  projectId: string;
  workspaceId: string;
  userId: string;
  /** The words the presenter speaks. */
  script: string;
  voice: string;
  /** ISO 639-1 language of the script. */
  languageCode: string;
  /** A stock presenter, or the requester's own photo in Files. */
  presenter:
    | { kind: "stock"; id: string }
    | { kind: "file"; fileId: string; actor: FileActor; consentAt: Date };
  /** Show the Project's website; omitted, it is shown when there is one. */
  siteShots?: boolean;
  /** Open on a generated B-roll clip. */
  broll?: boolean;
  /** Lay generated music under the voice. */
  music?: boolean;
  /** The shapes to cut it in; vertical alone when omitted. */
  shapes?: VideoShape[];
  idempotencyKey: string;
}

/**
 * Whether a talking video shows the Project's website: unless it was turned
 * off, whenever the Project has one. Decided before the quote, which it is
 * part of.
 */
export async function talkingVideoShowsSite(
  projectId: string,
  requested?: boolean,
): Promise<boolean> {
  if (requested === false) return false;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { websiteUrl: true },
  });
  return Boolean(project?.websiteUrl);
}

/**
 * Create (or replay) a talking video job and, when this caller owns the lease,
 * send it. The same row, lease, quote and settlement as every studio job.
 *
 * The quote comes from the script, because the video is as long as the voice
 * and the voice is not made until the job is sent.
 */
/**
 * The shapes a new video is made in: the first is the job itself, the rest
 * are cut from its parts once it is delivered. Vertical when none are named.
 */
function wantedShapes(
  format: ShortVideoFormat | null,
  shapes: readonly VideoShape[] | undefined,
): Pick<
  TalkingVideoSettings,
  "aspectRatio" | "shape" | "shapes" | "sourceJobId" | "siteDesktopPagePathname"
> {
  const [shape, ...rest] = videoShapesFor(
    videoRecipeFor(format),
    shapes ?? [DEFAULT_VIDEO_SHAPE],
  );
  return {
    aspectRatio: shape!,
    shape: shape!,
    shapes: rest,
    sourceJobId: null,
    siteDesktopPagePathname: null,
  };
}

export async function createTalkingVideoJob(input: CreateTalkingVideoJobInput) {
  const access = await requireProjectAccess({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  requireStudioBlobToken();

  let model: TalkingVideoModel;
  try {
    model = talkingVideoModel(input.modelId);
  } catch (error) {
    throw unprocessableEntity(
      error instanceof Error ? error.message : "Invalid talking video model",
      { kind: "invalid_video_settings" },
    );
  }
  if (posesAsCustomerTestimonial(input.script))
    throw unprocessableEntity(TALKING_VIDEO_TESTIMONIAL_MESSAGE, {
      kind: "talking_video_testimonial",
    });
  if (
    input.presenter.kind === "stock" &&
    !findTalkingVideoPresenter(input.presenter.id)
  )
    throw unprocessableEntity("Choose a presenter from the list.", {
      kind: "invalid_video_settings",
    });

  const settings: TalkingVideoSettings = {
    durationSeconds: talkingVideoQuotedSeconds(input.script),
    resolution: TALKING_VIDEO_RESOLUTION,
    voice: input.voice,
    presenterId: input.presenter.kind === "stock" ? input.presenter.id : null,
    languageCode: input.languageCode,
    words: [],
    hookLine: null,
    siteShots: await talkingVideoShowsSite(input.projectId, input.siteShots),
    sitePagePathname: null,
    broll: input.broll === true,
    brollRequestId: null,
    music: input.music === true,
    musicRequestId: null,
    format: null,
    picturePathnames: [],
    ...wantedShapes(null, input.shapes),
  };
  const ownPhoto = input.presenter.kind === "file" ? input.presenter : null;
  return await reserveAndSend({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    sessionId: null,
    prompt: input.script,
    idempotencyKey: input.idempotencyKey,
    forCmoMonth: input.forCmoMonth,
    kind: ProjectImageJobKind.TALKING_VIDEO,
    model: model.endpoint,
    settings,
    referenceAssetIds: [],
    referenceFileIds: ownPhoto ? [ownPhoto.fileId] : [],
    referenceFileActor: ownPhoto?.actor,
    presenterConsentAt: ownPhoto?.consentAt,
    parentAssetId: null,
    organizationId: access.organizationId,
    chargedCredits: creditsPerTalkingVideo(model, input.script, settings),
  });
}

export interface CreateShortVideoJobInput {
  /** Core's month media (cmo-media-maker), as for a talking video. */
  forCmoMonth?: boolean;
  projectId: string;
  workspaceId: string;
  userId: string;
  format: ShortVideoFormat;
  /** What the voice says, or for a slideshow the lines shown, one a picture. */
  script: string;
  /** The words over the first seconds; omitted, they are written from the script. */
  hookLine?: string | null;
  voice: string;
  /** ISO 639-1 language of the script. */
  languageCode: string;
  /**
   * The studio's pictures and Files images the short shows, in order. A
   * person's request names who reads the Files, checked at once; Core's
   * month media is checked when the short is sent.
   */
  pictures: { assetIds: string[]; fileIds: string[]; actor?: FileActor };
  /** The shapes to cut it in; vertical alone when omitted. */
  shapes?: VideoShape[];
  idempotencyKey: string;
}

/**
 * Create (or replay) a short: a vertical video without a presenter, cut from
 * the brand's pictures and site to a voice or to music. Stored as a talking
 * video, so it is listed, published and charged like one.
 */
export async function createShortVideoJob(input: CreateShortVideoJobInput) {
  const access = await requireProjectAccess({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
  });
  requireStudioBlobToken();
  const spoken = !SHORT_VIDEO_TEXT_FORMATS.includes(input.format);
  const pictureCount =
    input.pictures.assetIds.length + input.pictures.fileIds.length;
  if (pictureCount > SHORT_VIDEO_MAX_PICTURES)
    throw unprocessableEntity(
      `A short shows at most ${SHORT_VIDEO_MAX_PICTURES} pictures.`,
      { kind: "invalid_video_settings" },
    );
  const showsSite = await talkingVideoShowsSite(input.projectId);
  if (pictureCount === 0 && !showsSite)
    throw unprocessableEntity(
      "Add a picture, or a website to the Project, for the short to show.",
      { kind: "invalid_video_settings" },
    );
  if (input.format === "site_tour" && !showsSite)
    throw unprocessableEntity("A website tour needs the Project's website.", {
      kind: "invalid_video_settings",
    });
  if (posesAsCustomerTestimonial(input.script))
    throw unprocessableEntity(TALKING_VIDEO_TESTIMONIAL_MESSAGE, {
      kind: "talking_video_testimonial",
    });
  if (input.pictures.assetIds.length > 0) {
    const found = await prisma.projectImageAsset.count({
      where: {
        id: { in: input.pictures.assetIds },
        projectId: input.projectId,
        mediaType: ProjectImageMediaType.IMAGE,
      },
    });
    if (found !== new Set(input.pictures.assetIds).size)
      throw notFound("A picture for the short was not found");
  }

  const settings: TalkingVideoSettings = {
    durationSeconds: talkingVideoQuotedSeconds(input.script),
    resolution: TALKING_VIDEO_RESOLUTION,
    voice: spoken ? input.voice : "",
    presenterId: null,
    languageCode: input.languageCode,
    words: [],
    hookLine: spoken ? input.hookLine?.trim() || null : null,
    siteShots: showsSite,
    sitePagePathname: null,
    broll: false,
    brollRequestId: null,
    music: true,
    musicRequestId: null,
    format: input.format,
    picturePathnames: [],
    ...wantedShapes(input.format, input.shapes),
  };
  return await reserveAndSend({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    sessionId: null,
    prompt: input.script,
    idempotencyKey: input.idempotencyKey,
    forCmoMonth: input.forCmoMonth,
    kind: ProjectImageJobKind.TALKING_VIDEO,
    model: TALKING_VIDEO_MUSIC_ENDPOINT,
    settings,
    referenceAssetIds: input.pictures.assetIds,
    referenceFileIds: input.pictures.fileIds,
    referenceFileActor: input.pictures.actor,
    parentAssetId: null,
    organizationId: access.organizationId,
    chargedCredits: creditsPerShortVideo(input.script, input.format),
  });
}

function isVideoKind(kind: ProjectImageJobKind): boolean {
  return (
    kind === ProjectImageJobKind.TEXT_TO_VIDEO ||
    kind === ProjectImageJobKind.IMAGE_TO_VIDEO ||
    kind === ProjectImageJobKind.TALKING_VIDEO
  );
}

/**
 * A talking video's second provider request, made once its presenter clip is
 * back: the presenter's cut-out when the video shows the brand's site, or
 * captions when the voice's words could not be timed for Core's own edit.
 * Null when the clip needs neither.
 */
function talkingVideoSecondStep(
  settings: TalkingVideoSettings,
  videoUrl: string,
): { endpoint: string; input: Record<string, unknown> } | null {
  if (settings.format) return null;
  if (settings.words.length === 0)
    return {
      endpoint: TALKING_VIDEO_CAPTION_ENDPOINT,
      input: buildTalkingVideoCaptionInput({
        videoUrl,
        languageCode: settings.languageCode,
      }),
    };
  if (settings.sitePagePathname || settings.siteDesktopPagePathname)
    return {
      endpoint: TALKING_VIDEO_CUTOUT_ENDPOINT,
      input: buildTalkingVideoCutoutInput({ videoUrl }),
    };
  return null;
}

/**
 * The endpoint a job's provider request was sent to. A talking video's second
 * request is on another endpoint than the model the row names.
 */
function queueModel(job: {
  model: string;
  pendingMediaUrl: string | null;
  settings: Prisma.JsonValue;
}): string {
  if (!job.pendingMediaUrl) return job.model;
  return (
    talkingVideoSecondStep(
      readTalkingVideoSettings(job.settings),
      job.pendingMediaUrl,
    )?.endpoint ?? job.model
  );
}

/**
 * The voice is a constant 128 kbps mp3, so its size gives its length when the
 * voice service sends no word timings.
 */
const MP3_BYTES_PER_SECOND = 16_000;

/** How much longer than its quote a voice may run before the job is refused. */
const VOICE_OVERRUN_LIMIT = 2;

/**
 * Speak a talking video's script and name the presenter photo, as the input
 * its model takes. The voice is kept in the studio's store and on the row.
 */
async function prepareTalkingVideo(
  job: {
    id: string;
    projectId: string;
    workspaceId: string;
    requestedByUserId: string;
    idempotencyKey: string;
    prompt: string;
    model: string;
    settings: Prisma.JsonValue;
    referenceFileIds: string[];
  },
  organizationId: string | null,
  step: (reason: ImageJobFailureReason) => void,
): Promise<Record<string, unknown>> {
  const settings = readTalkingVideoSettings(job.settings);
  // Started first: the page loads while the voice is made.
  const sitePage = storeTalkingVideoSitePages(job, settings);
  step("reference_not_sendable");
  const stock = settings.presenterId
    ? findTalkingVideoPresenter(settings.presenterId)
    : null;
  let imageUrl = stock?.imageUrl;
  if (!imageUrl) {
    const fileId = job.referenceFileIds[0];
    if (!fileId) throw new Error("The talking video has no presenter photo.");
    const { bytes } = await downloadStudioFileReference(
      job.workspaceId,
      fileId,
      {
        userId: job.requestedByUserId,
        organizationId,
        kind: automatedRequestKind(job.idempotencyKey),
      },
    );
    imageUrl = await uploadReference({
      bytes: await frameTalkingVideoPresenter(bytes),
      contentType: "image/jpeg",
      fileName: `${fileId}.jpg`,
    });
  }

  step("voice_unavailable");
  const { voiceBlobPathname, audioUrl, spokenSeconds, words, hookLine } =
    await speakScript(job, settings);
  // The paid extras last, once nothing before them can fail.
  const [pages, brollRequestId, musicRequestId] = await Promise.all([
    sitePage,
    settings.broll && hookTakesBroll(words, spokenSeconds)
      ? writeTalkingVideoBrollPrompt(job.prompt).then((prompt) =>
          prompt
            ? startTalkingVideoExtra(
                TALKING_VIDEO_BROLL_ENDPOINT,
                buildTalkingVideoBrollInput({ prompt }),
              )
            : null,
        )
      : null,
    settings.music
      ? startTalkingVideoExtra(
          TALKING_VIDEO_MUSIC_ENDPOINT,
          buildTalkingVideoMusicInput(),
        )
      : null,
  ]);
  const made: TalkingVideoSettings = {
    ...settings,
    durationSeconds: spokenSeconds,
    words,
    hookLine,
    ...pages,
    broll: brollRequestId !== null,
    brollRequestId,
    music: musicRequestId !== null,
    musicRequestId,
  };
  await prisma.projectImageJob.update({
    where: { id: job.id },
    data: {
      voiceBlobPathname,
      settings: jsonInput(made),
      // What could not be started is not charged for.
      ...((settings.siteShots && !made.siteShots) ||
      (settings.broll && !made.broll) ||
      (settings.music && !made.music)
        ? {
            chargedCents: convertCreditsToCents(
              creditsPerTalkingVideo(
                talkingVideoModelForEndpoint(job.model),
                job.prompt,
                made,
              ),
            ),
          }
        : {}),
    },
    select: { id: true },
  });
  step("request_not_supported");
  return buildTalkingVideoInput({ imageUrl, audioUrl });
}

/**
 * Speak a script, keep the voice in the studio's store, and time its words. The hook line is written beside it unless one was given.
 */
async function speakScript(
  job: { id: string; projectId: string; prompt: string },
  settings: TalkingVideoSettings,
): Promise<{
  voiceBlobPathname: string;
  audioUrl: string;
  spokenSeconds: number;
  words: SpokenWord[];
  hookLine: string | null;
}> {
  const voice = await speakVoiceover({
    text: job.prompt,
    voice: settings.voice,
    languageCode: settings.languageCode,
  });
  const quotedSeconds = settings.durationSeconds;
  const spokenSeconds = Math.ceil(
    voice.durationSeconds ?? voice.bytes.byteLength / MP3_BYTES_PER_SECOND,
  );
  if (spokenSeconds > quotedSeconds * VOICE_OVERRUN_LIMIT)
    throw new Error("The voice ran far longer than the script was quoted at.");
  const stored = await put(
    `projects/${job.projectId}/image-studio/${job.id}-voice.mp3`,
    voice.bytes as unknown as Buffer,
    {
      access: "private",
      token: requireStudioBlobToken(),
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "audio/mpeg",
      abortSignal: AbortSignal.timeout(60_000),
    },
  );
  const audioUrl = await uploadReference({
    bytes: voice.bytes,
    contentType: "audio/mpeg",
    fileName: `${job.id}.mp3`,
  });
  const [words, hookLine] = await Promise.all([
    timeSpokenWords({
      audioUrl,
      script: job.prompt,
      languageCode: settings.languageCode,
    }),
    settings.hookLine ??
      writeTalkingVideoHookLine({
        script: job.prompt,
        languageCode: settings.languageCode,
      }),
  ]);
  return {
    voiceBlobPathname: stored.pathname,
    audioUrl,
    spokenSeconds,
    words,
    hookLine,
  };
}

/** A short's pictures, framed 9:16 and kept in the studio's store, in order. */
async function storeShortVideoPictures(
  job: {
    id: string;
    projectId: string;
    workspaceId: string;
    requestedByUserId: string;
    idempotencyKey: string;
    referenceAssetIds: string[];
    referenceFileIds: string[];
  },
  organizationId: string | null,
): Promise<string[]> {
  const assets = await prisma.projectImageAsset.findMany({
    where: { id: { in: job.referenceAssetIds }, projectId: job.projectId },
    select: { id: true, blobPathname: true },
  });
  const sources = [
    ...job.referenceAssetIds.map(async (assetId) => {
      const asset = assets.find((candidate) => candidate.id === assetId);
      if (!asset) throw notFound("A picture for the short was not found");
      return await readAssetBytes(asset.blobPathname);
    }),
    ...job.referenceFileIds.map(
      async (fileId) =>
        (
          await downloadStudioFileReference(job.workspaceId, fileId, {
            userId: job.requestedByUserId,
            organizationId,
            kind: automatedRequestKind(job.idempotencyKey),
          })
        ).bytes,
    ),
  ];
  return await Promise.all(
    sources.map(async (source, index) => {
      const framed = await keepVideoPicture(await source);
      const stored = await put(
        `projects/${job.projectId}/image-studio/${job.id}-picture-${index}.jpg`,
        framed as unknown as Buffer,
        {
          access: "private",
          token: requireStudioBlobToken(),
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: "image/jpeg",
          abortSignal: AbortSignal.timeout(60_000),
        },
      );
      return stored.pathname;
    }),
  );
}

/**
 * Get a short ready to send: its pictures copied in, its site captured, its
 * voice spoken and timed (or its lines timed for reading). The request
 * returned is its one paid call: the music.
 */
async function prepareShortVideo(
  job: {
    id: string;
    projectId: string;
    workspaceId: string;
    requestedByUserId: string;
    idempotencyKey: string;
    prompt: string;
    settings: Prisma.JsonValue;
    referenceAssetIds: string[];
    referenceFileIds: string[];
  },
  organizationId: string | null,
  step: (reason: ImageJobFailureReason) => void,
): Promise<Record<string, unknown>> {
  const settings = readTalkingVideoSettings(job.settings);
  const format = settings.format!;
  const sitePage = storeTalkingVideoSitePages(job, settings);
  step("reference_not_sendable");
  const picturePathnames = await storeShortVideoPictures(job, organizationId);
  let words: SpokenWord[];
  let seconds: number;
  let hookLine: string | null = null;
  let voiceBlobPathname: string | null = null;
  if (SHORT_VIDEO_TEXT_FORMATS.includes(format)) {
    words = readingTimings(job.prompt);
    seconds = Math.ceil(words.at(-1)?.end ?? 0);
  } else {
    step("voice_unavailable");
    const spoken = await speakScript(job, settings);
    seconds = spoken.spokenSeconds;
    hookLine = spoken.hookLine;
    voiceBlobPathname = spoken.voiceBlobPathname;
    // Words the voice service could not time are spread over the voice.
    const read = readingTimings(job.prompt);
    const scale = seconds / (read.at(-1)?.end || 1);
    words = spoken.words.length
      ? spoken.words
      : read.map((word) => ({
          text: word.text,
          start: word.start * scale,
          end: word.end * scale,
        }));
  }
  const pages = await sitePage;
  if (picturePathnames.length === 0 && !pages.siteShots)
    throw new Error("The short has neither pictures nor a site to show.");
  const made: TalkingVideoSettings = {
    ...settings,
    durationSeconds: seconds,
    words,
    hookLine,
    ...pages,
    picturePathnames,
  };
  await prisma.projectImageJob.update({
    where: { id: job.id },
    data: { voiceBlobPathname, settings: jsonInput(made) },
    select: { id: true },
  });
  step("request_not_supported");
  return buildTalkingVideoMusicInput();
}

/**
 * Start one of a talking video's extras (its B-roll clip, its music) beside
 * the presenter. No webhook: the edit reads the result when it needs it. Null
 * when fal did not take the request, and the video is made without it.
 */
async function startTalkingVideoExtra(
  model: string,
  input: Record<string, unknown>,
): Promise<string | null> {
  const outcome = await submitToQueue({ model, input, webhookUrl: null });
  return outcome.kind === "queued" ? outcome.requestId : null;
}

/** How long the edit waits for an extra that is still being made. */
const EXTRA_WAIT_MS = 30_000;
const EXTRA_POLL_MS = 5_000;

/**
 * An extra's file, once fal has made it. Null when it failed or is not ready
 * within the wait: the video is edited without it.
 */
async function readTalkingVideoExtra(
  model: string,
  requestId: string | null,
  fallbackContentType: string,
): Promise<Uint8Array | null> {
  if (!requestId) return null;
  try {
    const deadline = Date.now() + EXTRA_WAIT_MS;
    for (;;) {
      const result = await fetchQueueResult({ model, requestId });
      if (result.kind === "media") {
        const { bytes } = await downloadMedia(
          result.media[0]!.url,
          LIMITS.IMAGE_STUDIO_MAX_TALKING_VIDEO_BYTES,
          fallbackContentType,
        );
        return bytes;
      }
      if (result.kind === "error" || Date.now() >= deadline) return null;
      await new Promise((resolve) => setTimeout(resolve, EXTRA_POLL_MS));
    }
  } catch {
    return null;
  }
}

/**
 * Screenshot the Project's website for a talking video and keep it in the
 * studio's store. Null when the Project has no website or it did not load.
 */
/**
 * The site as each wanted shape shows it: a phone's page for the upright and
 * square shapes, a desktop's for widescreen. One after the other, so only one
 * browser runs at a time.
 */
async function storeTalkingVideoSitePages(
  job: { id: string; projectId: string },
  settings: TalkingVideoSettings,
): Promise<
  Pick<
    TalkingVideoSettings,
    "siteShots" | "sitePagePathname" | "siteDesktopPagePathname"
  >
> {
  const shapes = [settings.shape, ...settings.shapes];
  const sitePagePathname =
    settings.siteShots && shapes.some((shape) => shape !== "16:9")
      ? await storeTalkingVideoSitePage(job)
      : null;
  const siteDesktopPagePathname =
    settings.siteShots && shapes.includes("16:9")
      ? await storeTalkingVideoSitePage(job, "desktop")
      : null;
  return {
    siteShots: sitePagePathname !== null || siteDesktopPagePathname !== null,
    sitePagePathname,
    siteDesktopPagePathname,
  };
}

async function storeTalkingVideoSitePage(
  job: {
    id: string;
    projectId: string;
  },
  device: "phone" | "desktop" = "phone",
): Promise<string | null> {
  try {
    const project = await prisma.project.findUnique({
      where: { id: job.projectId },
      select: { websiteUrl: true },
    });
    if (!project?.websiteUrl) return null;
    const page = await captureTalkingVideoSitePage(project.websiteUrl, device);
    if (!page) return null;
    const stored = await put(
      `projects/${job.projectId}/image-studio/${job.id}-site${device === "desktop" ? "-desktop" : ""}.jpg`,
      page as unknown as Buffer,
      {
        access: "private",
        token: requireStudioBlobToken(),
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "image/jpeg",
        abortSignal: AbortSignal.timeout(60_000),
      },
    );
    return stored.pathname;
  } catch {
    return null;
  }
}

/**
 * A person's own credential: a session, an API key or an OAuth token
 * (ADR 0077). Only these may cut a product out of a Drive photo; a Soko Bot
 * may not.
 */
function isUserFileActor(actor: FileActor | undefined): boolean {
  return actor !== undefined && DATA_ROOM_PEOPLE_KINDS.includes(actor.kind);
}

/**
 * These durable prefixes identify automated requests even during recovery.
 * A bot must never inherit the human requester's data-room access.
 */
function automatedRequestKind(
  idempotencyKey: string,
): "soko_bot" | "interactive" {
  return idempotencyKey.startsWith("soko-bot:") ||
    idempotencyKey.startsWith("cmo-media:")
    ? "soko_bot"
    : "interactive";
}

function readVideoSettings(value: Prisma.JsonValue): VideoSettings {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    aspectRatio: typeof raw.aspectRatio === "string" ? raw.aspectRatio : "",
    durationSeconds:
      typeof raw.durationSeconds === "number" ? raw.durationSeconds : 0,
    resolution: typeof raw.resolution === "string" ? raw.resolution : "",
  };
}

/** Reserve the row, then send it if this caller holds the lease. */
async function reserveAndSend(input: ReserveImageJobInput) {
  const { job, created } = await reserveJob(input);
  if (!created) return job;

  if (job.parentAssetId) {
    await recordStudioAdEvent({
      workspaceId: input.workspaceId,
      assetId: job.parentAssetId,
      userId: input.userId,
      type: "refined",
      meta: { jobId: job.id },
    });
  }

  if (!(await claimForSubmission(job.id))) {
    // Someone else is already sending this row. Never a second call.
    return (await prisma.projectImageJob.findUnique({
      where: { id: job.id },
    }))!;
  }

  return await sendClaimedJob(job.id, input.organizationId);
}

/** Sends a job whose lease this caller already holds. */
async function sendClaimedJob(jobId: string, organizationId: string | null) {
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
  if (job.kind === ProjectImageJobKind.TALKING_VIDEO) {
    // No assembled prompt and no snapshot: the script is spoken as written.
    let reason: ImageJobFailureReason = "reference_not_sendable";
    let request: Record<string, unknown>;
    try {
      // The voice is bought here, before the video: a few cents the studio
      // carries when a later step fails, since only a delivery is charged.
      const prepare = readTalkingVideoSettings(job.settings).format
        ? prepareShortVideo
        : prepareTalkingVideo;
      request = await prepare(job, organizationId, (step) => {
        reason = step;
      });
    } catch (error) {
      return await failBeforeSend(job.id, reason, error);
    }
    return await submitPreparedJob(job, request);
  }

  const letteringEdit =
    job.lettering === "ideogram" && job.letteringQuoteCents == null;
  let input: Record<string, unknown>;
  let snapshot: Prisma.ProjectImagePromptSnapshotUncheckedCreateInput;
  // Which half failed, so the person is told the right thing. Set before each
  // step rather than guessed from the message afterwards.
  let preflightReason: ImageJobFailureReason = job.useProductCutout
    ? "product_cutout_unavailable"
    : "reference_not_sendable";
  try {
    if (job.useProductCutout) {
      const { checksum } = await readProductCutout(job, organizationId);
      if (job.productCutoutChecksum && job.productCutoutChecksum !== checksum)
        throw unprocessableEntity("The original product photo has changed.");
      if (!job.productCutoutChecksum) {
        await prisma.projectImageJob.update({
          where: { id: job.id },
          data: { productCutoutChecksum: checksum },
          select: { id: true },
        });
      }
      preflightReason = "reference_not_sendable";
    }
    const [imageUrls, brand] = await Promise.all([
      buildReferenceUrls(job, organizationId),
      loadStudioBrand(job.projectId),
    ]);
    preflightReason = "request_not_supported";
    // Brand is for fal only. The stored prompt stays the brief. A missing
    // Design or Memory is ignored so a brand read never blocks a generation.
    const backdropInstruction = imageUrls.length
      ? "Edit the supplied advertising backdrop according to the brief."
      : "Create an empty advertising backdrop according to the brief.";
    const promptBrand =
      job.exportHeadline || job.useProductCutout
        ? { ...brand, approvedLines: undefined }
        : brand;
    // A picture in a reference library style is Cuso's brief alone: the
    // brand block (ad copy, Brand Brain, DESIGN.md, Memory) made its prompt
    // 4,300 characters and was lettered into it (2026-11-20).
    const styled = (job.referenceLibraryIds?.length ?? 0) > 0;
    const prompt =
      letteringEdit && job.exportHeadline
        ? buildStudioLetteringPrompt(
            job.exportHeadline,
            await readStudioBrandKit(job.projectId),
          )
        : styled
          ? job.prompt
          : applyStudioBrandPrompt(
              job.useProductCutout
                ? backdropInstruction +
                    " Leave a surface in the lower center for a product cutout. Keep the central area clear. Leave products, people, promotional text, and logos out of the artwork. Use the brief for the setting, palette, and lighting only.\n\n" +
                    job.prompt
                : job.prompt,
              promptBrand,
              job.model === RECRAFT_VECTOR_ENDPOINT,
            );
    let finalPrompt = prompt;
    if (isVideoKind(job.kind)) {
      const model = findVideoModelForEndpoint(job.model);
      if (!model) throw new Error("Unsupported video model endpoint.");
      input = buildFalVideoInput(model, {
        prompt,
        settings: readVideoSettings(job.settings),
        imageUrl: imageUrls[0] ?? null,
      });
    } else {
      const settings = readSettings(job.settings);
      const photoCount =
        job.useProductCutout || styled ? 0 : job.referenceFileIds.length;
      const productPhotoGuidance = photoCount
        ? `\n\nUse the ${photoCount === 1 ? "last reference image" : `last ${photoCount} reference images`} for the advertised product's appearance. Keep its shape, colors, materials, packaging, and any legible label text unless the brief explicitly asks to change them.`
        : "";
      const headlineGuidance =
        job.exportHeadline && !letteringEdit
          ? "\n\nStudio adds the approved headline after generation. Keep the upper area clear for the headline and leave marketing text out of the artwork. Preserve text printed on the product and its packaging."
          : "";
      let maskUrl: string | undefined;
      if (letteringEdit) {
        preflightReason = "reference_not_sendable";
        if (!imageUrls[0]) {
          throw new Error(
            "Ideogram lettering needs the delivered backdrop as a reference.",
          );
        }
        const backdrop = await downloadMedia(
          imageUrls[0],
          LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES,
        );
        const mask = await renderHeadlineMask(backdrop.bytes);
        maskUrl = await uploadReference({
          bytes: mask.bytes,
          contentType: "image/png",
          fileName: "headline-mask.png",
        });
        preflightReason = "request_not_supported";
      }
      finalPrompt += productPhotoGuidance + headlineGuidance;
      input = buildFalInput(
        {
          prompt: finalPrompt,
          brandColors: brand.look?.colors ?? brand.designColors,
          aspectRatio: settings.aspectRatio,
          resolution: settings.resolution,
          outputFormat: settings.outputFormat,
          seed: settings.seed,
          imageUrls,
          maskUrl,
        },
        job.model,
      );
    }
    snapshot = {
      jobId: job.id,
      finalPrompt:
        typeof input.prompt === "string" ? input.prompt : finalPrompt,
      brandContextHash: crypto
        .createHash("sha256")
        .update(studioBrandPromptBlock(promptBrand))
        .digest("hex"),
      brandLook: brand.look ? jsonInput(brand.look) : Prisma.DbNull,
      route: readImageStudioRoute(job.settings) ?? null,
      experimentArm: readStudioRouterArm(job.settings),
      assemblyVersion: STUDIO_PROMPT_ASSEMBLY_VERSION,
      templateId: job.templateId ?? null,
      creativeDirection: job.creativeDirection ?? null,
      variationIndex: job.variationIndex ?? null,
    };
  } catch (error) {
    return await failBeforeSend(job.id, preflightReason, error);
  }

  // Track the write through response completion without holding up the paid call.
  waitUntil(
    runAsBackgroundWork(async () => {
      const { jobId: snapshotJobId, ...data } = snapshot;
      await prisma.projectImagePromptSnapshot.upsert({
        where: { jobId: snapshotJobId },
        create: snapshot,
        update: data,
      });
    }).catch((error: unknown) => {
      // The write carries the prompt, which a database error can quote.
      emitCoreWarning(
        {
          operation: "image_prompt_snapshot",
          imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
        },
        {
          message: "Could not save the prompt snapshot of an image generation",
          why: "The database write of the snapshot failed",
          fix: "The generation goes on without it; only the record of the prompt sent is missing.",
        },
      );
    }),
  );

  return await submitPreparedJob(job, input);
}

/** Settle a job whose request could not be prepared. Nothing was sent. */
async function failBeforeSend(
  jobId: string,
  reason: ImageJobFailureReason,
  error: unknown,
) {
  // The error can quote the prompt it was building, so no cause.
  recordCoreWarning(
    {
      operation: "image_job_submit",
      imageJobs: [
        {
          id: jobId,
          failureReason: reason,
          failure: messageSafeErrorFields(error),
        },
      ],
    },
    {
      message: "An image generation failed before it was sent",
      why: "Preparing the request for the image provider threw",
      fix: "Nothing was sent or charged and the job is marked failed. If this repeats, look up failureReason and the error name under failure.",
    },
  );
  // Nothing to give back: the charge happens on delivery, and there was none.
  return await prisma.projectImageJob.update({
    where: { id: jobId },
    data: {
      status: ProjectImageJobStatus.FAILED,
      error: imageJobFailureMessage(reason),
      failureReason: reason,
      settledAt: new Date(),
      submitLeaseAt: null,
    },
  });
}

/** The paid call: send a prepared request and record what the provider said. */
async function submitPreparedJob(
  job: { id: string; model: string },
  input: Record<string, unknown>,
) {
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
      // The provider's message can quote the prompt, so only its status.
      recordCoreWarning(
        {
          operation: "image_job_submit",
          imageJobs: [
            { id: job.id, provider: { name: "fal", status: outcome.status } },
          ],
        },
        {
          message: "The image provider refused a generation",
          why: "fal answered the submission with a rejection",
          fix: "Nothing was queued or charged and the job is marked failed. Look up the status under provider.",
        },
      );
      return await prisma.projectImageJob.update({
        where: { id: job.id },
        data: {
          status: ProjectImageJobStatus.FAILED,
          error: imageJobFailureMessage("provider_rejected"),
          failureReason: "provider_rejected",
          settledAt: new Date(),
          submitLeaseAt: null,
        },
      });
    }
    case "uncertain":
      recordCoreWarning(
        { operation: "image_job_submit", imageJobs: [{ id: job.id }] },
        {
          message:
            "Could not tell whether the image provider received a generation",
          why: "The submission to fal ended without a clear answer",
          fix: "The job is marked uncertain and is never refunded on its own; reconciling it asks fal for the outcome.",
        },
      );
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
  if (isVideoShapeJob(job)) {
    await settleVideoShapeJob(job);
    return;
  }
  // Without a provider request id there is nothing to ask about.
  if (!job.falRequestId) return;
  // Includes SUBMISSION_UNCERTAIN: we hold its request id, so the provider can
  // still tell us it succeeded. Refusing to look was what made paid images
  // behind an outage permanently unreachable.
  if (!(LIVE_STATUSES as readonly string[]).includes(job.status)) {
    return;
  }

  const status = await fetchQueueStatus({
    model: queueModel(job),
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
        // A cancelled caption step leaves the presenter's video, which fal
        // has already made and billed: keep it, as a finished image is kept.
        if (await deliverUncaptionedTalkingVideo(job.id)) return;
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
    model: queueModel(job),
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
  // {@link settleWithMedia} clears it once the bytes are actually stored.
  //
  // Settled even when cancellation was requested: fal may accept a
  // cancellation and finish anyway, and an image we paid for should be kept.
  const produced = result.media[0]!;
  await settleWithMedia(job.id, produced.url, produced, job.falRequestId);
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
    select: {
      statusUnreachableSince: true,
      resultUnreachableSince: true,
      authUnreachableSince: true,
    },
  });

  const startedAt = updated[column];

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
  if (await deliverUncaptionedTalkingVideo(jobId)) return;
  await markImageJobFailed(jobId, reason, providerDetail);
}

/**
 * Fails a job as it stands, without `failImageJob`'s fallback to a talking
 * video's presenter clip: for a failure of Core's own edit, where that
 * fallback would only run the same edit again.
 */
async function markImageJobFailed(
  jobId: string,
  reason: ImageJobFailureReason,
  providerDetail?: string,
): Promise<void> {
  if (providerDetail) {
    // Where a raw transport string belongs. "Unexpected status code: 422" is
    // useful to whoever is debugging the job and useless to whoever was waiting
    // for the image.
    // Its text can quote the prompt, so only that it came with one.
    recordCoreWarning(
      {
        operation: "image_job_settle",
        imageJobs: [{ id: jobId, failureReason: reason }],
      },
      {
        message: "The image provider failed a generation",
        why: "fal reported the generation as failed",
        fix: "The job is marked failed and nothing is charged. Look up failureReason; the provider's own text is not logged because it can quote the prompt.",
      },
    );
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
  nudgeCmoMonth(jobId);
}

/**
 * A job Core started for a CMO month settled: the month moves on now, so
 * the next picture starts and this one goes on its post without waiting
 * for the ten-minute sync (cmo-media-maker.service).
 */
function nudgeCmoMonth(jobId: string): void {
  waitUntil(
    runAsBackgroundWork(async () => {
      const job = await prisma.projectImageJob.findUnique({
        where: { id: jobId },
        select: { projectId: true, idempotencyKey: true, settings: true },
      });
      if (!job) return;
      // A shape of a month's video moves the month on like the video itself.
      const { sourceJobId } = readTalkingVideoSettings(job.settings);
      const key = sourceJobId
        ? (
            await prisma.projectImageJob.findUnique({
              where: { id: sourceJobId },
              select: { idempotencyKey: true },
            })
          )?.idempotencyKey
        : job.idempotencyKey;
      if (!key?.startsWith("cmo-media:")) return;
      const { startCmoProductionForProject } = await import(
        "@/services/cmo-cuso.service"
      );
      await startCmoProductionForProject(job.projectId);
    }).catch((error: unknown) => {
      // CMO production writes generated text, which its errors can quote.
      emitCoreWarning(
        {
          operation: "image_job_cmo_nudge",
          imageJobs: [{ id: jobId, failure: messageSafeErrorFields(error) }],
        },
        {
          message: "Could not move a CMO month on after an image settled",
          why: "Starting CMO production for the project threw",
          fix: "Nothing is lost: the CMO production sync moves the month on within ten minutes.",
        },
      );
    }),
  );
}

type StudioMediaInfo = Pick<FalMedia, "width" | "height"> &
  Partial<Pick<FalMedia, "contentType">>;

/**
 * Store the generated image and publish the version.
 *
 * Idempotent on the job: `ProjectImageAsset.jobId` is unique, so a webhook and
 * a poll arriving together produce one asset and one of them loses the insert.
 */
export async function settleWithMedia(
  jobId: string,
  sourceUrl: string,
  mediaInfo?: StudioMediaInfo,
  /** The provider request this media answers. */
  requestId?: string,
): Promise<void> {
  if (await startTalkingVideoSecondStep(jobId, sourceUrl, requestId)) return;
  await storeMedia(jobId, sourceUrl, mediaInfo);
  nudgeCmoMonth(jobId);
}

/**
 * A talking video came back from its presenter model and needs a second
 * step (`talkingVideoSecondStep`): send it on instead of storing it. True
 * when this media is not the one to store.
 *
 * The same row carries both requests, so the answer to the first can arrive
 * again after the second was sent: a webhook retry, or a poll that read the
 * old request id. `requestId` tells those apart, and the lease is taken on it,
 * so the second request is sent once.
 */
async function startTalkingVideoSecondStep(
  jobId: string,
  sourceUrl: string,
  requestId: string | undefined,
): Promise<boolean> {
  const job = await prisma.projectImageJob.findUnique({
    where: { id: jobId },
    select: {
      kind: true,
      falRequestId: true,
      pendingMediaUrl: true,
      settings: true,
    },
  });
  if (job?.kind !== ProjectImageJobKind.TALKING_VIDEO) return false;
  if (requestId && job.falRequestId !== requestId) return true;
  if (job.pendingMediaUrl) return false;
  const next = talkingVideoSecondStep(
    readTalkingVideoSettings(job.settings),
    sourceUrl,
  );
  if (!next) return false;

  const lease = await claimForSettlement(jobId, requestId);
  if (!lease) return true;
  const outcome = await submitToQueue({
    model: next.endpoint,
    input: next.input,
    webhookUrl: webhookUrl(),
  });
  if (outcome.kind !== "queued") {
    await releaseSettlementLease(jobId, lease);
    recordCoreWarning(
      {
        operation: "image_job_settle",
        imageJobs: [{ id: jobId, secondStep: { outcome: outcome.kind } }],
      },
      {
        message: "Delivered a talking video without its second step",
        why: "fal did not accept the cut-out or caption request",
        fix: "The video was made from its presenter clip alone: no site shots, or no captions. If this repeats, check that endpoint and its input.",
      },
    );
    return false;
  }
  await prisma.projectImageJob.updateMany({
    where: { id: jobId, settleLeaseOwner: lease },
    data: {
      falRequestId: outcome.requestId,
      pendingMediaUrl: sourceUrl,
      status: ProjectImageJobStatus.RUNNING,
      settleLeaseAt: null,
      settleLeaseOwner: null,
    },
  });
  return true;
}

/**
 * A video delivered only as Core's edit: a shape other than vertical, or a
 * shape cut from another job. The provider's own clip is vertical, so it is
 * never a fallback for these.
 */
function onlyEdited(talking: TalkingVideoSettings): boolean {
  return talking.sourceJobId !== null || talking.shape !== "9:16";
}

/**
 * A talking video whose caption step failed is still a video the studio paid
 * for: deliver it as its presenter model made it. True when it was handled.
 */
async function deliverUncaptionedTalkingVideo(jobId: string): Promise<boolean> {
  const job = await prisma.projectImageJob.findUnique({
    where: { id: jobId },
    select: { kind: true, pendingMediaUrl: true },
  });
  // A shape other than vertical is still edited from the clip, without the
  // step that failed; a failure of that edit fails the job for good
  // (`markImageJobFailed`), so this never runs it twice.
  if (job?.kind !== ProjectImageJobKind.TALKING_VIDEO || !job.pendingMediaUrl)
    return false;
  recordCoreWarning(
    { operation: "image_job_settle", imageJobs: [{ id: jobId }] },
    {
      message: "Delivered a talking video without captions",
      why: "fal reported the caption step as failed",
      fix: "The video was kept as its presenter model made it. If this repeats, check the caption endpoint and its input.",
    },
  );
  await storeMedia(jobId, job.pendingMediaUrl);
  nudgeCmoMonth(jobId);
  return true;
}

/** The site's page as this job's shape shows it: a desktop's for widescreen. */
function shapePagePathname(settings: TalkingVideoSettings): string | null {
  return settings.shape === "16:9"
    ? settings.siteDesktopPagePathname
    : settings.sitePagePathname;
}

/**
 * What the site shots of a talking video are made from: the clip's matte,
 * from the cut-out the job last asked for, and the site's stored screenshot.
 * Null when either cannot be read: the video is then edited without them.
 */
async function readTalkingVideoSite(
  job: { falRequestId: string | null },
  settings: TalkingVideoSettings,
): Promise<{ alpha: Uint8Array; page: Uint8Array } | null> {
  const pagePathname = shapePagePathname(settings);
  if (!job.falRequestId || !pagePathname) return null;
  try {
    const result = await fetchQueueResult({
      model: TALKING_VIDEO_CUTOUT_ENDPOINT,
      requestId: job.falRequestId,
    });
    if (result.kind !== "media") return null;
    // Colour first, then alpha; the alpha file is also named for it.
    const matte =
      result.media.find((file) => /alpha/i.test(file.url)) ?? result.media[1];
    if (!matte) return null;
    const [alpha, page] = await Promise.all([
      downloadMedia(
        matte.url,
        LIMITS.IMAGE_STUDIO_MAX_TALKING_VIDEO_BYTES,
        "video/mp4",
      ),
      readAssetBytes(pagePathname),
    ]);
    return { alpha: alpha.bytes, page };
  } catch {
    return null;
  }
}

/**
 * A short, put together from its music, its stored voice, pictures and site,
 * and the brand's end card. Null when it has no words to time by.
 */
async function makeShortVideo(
  job: {
    id: string;
    projectId: string;
    voiceBlobPathname: string | null;
  },
  settings: TalkingVideoSettings,
  music: Uint8Array,
): Promise<{ bytes: Uint8Array; durationSeconds: number } | null> {
  const pagePathname = shapePagePathname(settings);
  const [voice, pictures, page, endCard, brand] = await Promise.all([
    job.voiceBlobPathname ? readAssetBytes(job.voiceBlobPathname) : null,
    Promise.all(
      settings.picturePathnames.map(async (pathname) =>
        fitVideoPicture(await readAssetBytes(pathname), settings.shape),
      ),
    ),
    pagePathname ? readAssetBytes(pagePathname).catch(() => null) : null,
    prisma.project
      .findUnique({
        where: { id: job.projectId },
        select: { id: true, name: true, logo: true, websiteUrl: true },
      })
      .then((project) => (project ? loadTalkingVideoEndCard(project) : null)),
    loadStudioBrand(job.projectId),
  ]);
  const colour = (brand.look?.colors ?? brand.designColors ?? []).find(
    (value) => /^#[0-9a-f]{6}$/i.test(value),
  );
  const edited = await editShortVideo({
    shape: settings.shape,
    format: settings.format!,
    words: settings.words,
    seconds: settings.durationSeconds,
    hookLine: settings.hookLine,
    pictures,
    music,
    ...(voice ? { voice } : {}),
    ...(page ? { page } : {}),
    ...(endCard ? { endCard } : {}),
    ...(colour ? { cardColour: `0x${colour.slice(1)}` } : {}),
  });
  return edited;
}

/** Media types a log may name; the rest of a Content-Type is the provider's text. */
const LOGGABLE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/tiff",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

/** The provider's Content-Type cut to a known media type, else `unrecognized`. */
function loggableMediaType(contentType: string | null | undefined): string {
  const type = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return LOGGABLE_MEDIA_TYPES.has(type) ? type : "unrecognized";
}

/**
 * Store the generated image and publish the version.
 *
 * Idempotent on the job: `ProjectImageAsset.jobId` is unique, so a webhook and
 * a poll arriving together produce one asset and one of them loses the insert.
 */
async function storeMedia(
  jobId: string,
  sourceUrl: string,
  /**
   * What the provider said the image measures, when it said anything.
   *
   * fal reports `width`/`height` for some endpoints and not others, and settlement
   * used to take only the URL and throw these away — so even the endpoints that
   * *did* report a size had it discarded, and every non-PNG stored 0x0.
   */
  mediaInfo?: StudioMediaInfo,
  /** A shape job's source request, whose cut-out its site shots read. */
  sourceRequestId?: string,
): Promise<void> {
  const job = await prisma.projectImageJob.findUnique({
    where: { id: jobId },
    include: { asset: { select: { id: true } } },
  });
  if (!job || job.asset) return;
  const video = isVideoKind(job.kind);
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
  // `organizationId` too: it decides which pot the delivery debit comes out of, and
  // the access check has already read it.
  let project: {
    id: string;
    workspaceId: string;
    organizationId: string | null;
  };
  try {
    const access = await requireProjectAccessForUser({
      projectId: job.projectId,
      userId: job.requestedByUserId,
    });
    project = {
      id: access.projectId,
      workspaceId: access.workspaceId,
      organizationId: access.organizationId,
    };
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
    // The person keeps nothing and pays nothing: the charge only happens when an
    // asset is written, and none was.
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
    recordCoreError(
      { operation: "image_job_settle", imageJobs: [{ id: job.id }] },
      {
        message: "Deferred storing a generated image",
        why: "IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN is not set, so the image has nowhere private to go",
        fix: "Set IMAGE_STUDIO_BLOB_READ_WRITE_TOKEN for this deployment; the job stays live and settles on the next reconcile.",
      },
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

  const talking =
    job.kind === ProjectImageJobKind.TALKING_VIDEO
      ? readTalkingVideoSettings(job.settings)
      : null;
  // A short's one paid request is its music: Core makes the video around it.
  const short = talking?.format ? talking : null;
  // Core edits a clip whose words were timed. After a cut-out, `sourceUrl`
  // is the cut-out and the clip to edit is the one it was made from.
  const edits = talking !== null && !short && talking.words.length > 0;
  const clipUrl =
    edits && job.pendingMediaUrl ? job.pendingMediaUrl : sourceUrl;
  const cutOut = edits && clipUrl !== sourceUrl;

  let downloaded: Awaited<ReturnType<typeof downloadMedia>>;
  try {
    downloaded = video
      ? await downloadMedia(
          clipUrl,
          job.kind === ProjectImageJobKind.TALKING_VIDEO
            ? LIMITS.IMAGE_STUDIO_MAX_TALKING_VIDEO_BYTES
            : LIMITS.IMAGE_STUDIO_MAX_VIDEO_BYTES,
          short ? "audio/wav" : "video/mp4",
        )
      : await downloadMedia(sourceUrl, LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES);
    // A CDN that calls an mp4 `application/octet-stream` would make it
    // unplayable in the gallery and unattachable in Social.
    if (video && !short && !downloaded.contentType.startsWith("video/"))
      downloaded = { ...downloaded, contentType: "video/mp4" };
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

  let vectorSource: Uint8Array | undefined;
  if (
    !video &&
    (job.model === RECRAFT_VECTOR_ENDPOINT ||
      [mediaInfo?.contentType, downloaded.contentType].some(
        (type) => type?.split(";")[0]?.trim().toLowerCase() === "image/svg+xml",
      ))
  ) {
    try {
      const svg = new TextDecoder("utf-8", { fatal: true }).decode(
        downloaded.bytes,
      );
      if (unsafeSvgReason(svg)) throw new Error("Unsafe SVG");
      const bytes = await sharp(downloaded.bytes, {
        limitInputPixels: 16_000_000,
      })
        .timeout({ seconds: 10 })
        .png()
        .toBuffer();
      if (bytes.length > LIMITS.IMAGE_STUDIO_MAX_ASSET_BYTES)
        throw new Error("PNG exceeds the asset limit");
      vectorSource = downloaded.bytes;
      downloaded = { bytes, contentType: "image/png" };
    } catch {
      await failImageJob(job.id, "invalid_vector_image");
      return;
    }
  }

  let editedSeconds: number | null = null;
  let chargedCents = job.chargedCents;
  if (short) {
    try {
      const made = await makeShortVideo(job, short, downloaded.bytes);
      if (!made)
        throw new Error("The short had no words to time its shots by.");
      downloaded = { bytes: made.bytes, contentType: "video/mp4" };
      editedSeconds = Math.ceil(made.durationSeconds);
    } catch (error) {
      // Its music alone is no short. Nothing is delivered, so nothing is charged.
      recordCoreWarning(
        {
          operation: "image_job_settle",
          imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
        },
        {
          message: "Could not put a short together",
          why: "Reading its pictures, voice or site, or running the edit, threw",
          fix: "The job is marked failed and nothing is charged. If this repeats, check that Core can read the studio's store and run its ffmpeg build.",
        },
      );
      await releaseSettlementLease(job.id, lease);
      await failImageJob(job.id, "unknown");
      return;
    }
  } else if (talking && !edits && onlyEdited(talking)) {
    // Its words were never timed, so Core cannot cut it in its shape.
    await releaseSettlementLease(job.id, lease);
    await markImageJobFailed(job.id, "unknown");
    return;
  } else if (talking && edits) {
    try {
      const [site, endCard, broll, music] = await Promise.all([
        cutOut
          ? readTalkingVideoSite(
              { falRequestId: sourceRequestId ?? job.falRequestId },
              talking,
            )
          : null,
        prisma.project
          .findUnique({
            where: { id: project.id },
            select: { id: true, name: true, logo: true, websiteUrl: true },
          })
          .then((brand) => (brand ? loadTalkingVideoEndCard(brand) : null)),
        readTalkingVideoExtra(
          TALKING_VIDEO_BROLL_ENDPOINT,
          talking.brollRequestId,
          "video/mp4",
        ),
        readTalkingVideoExtra(
          TALKING_VIDEO_MUSIC_ENDPOINT,
          talking.musicRequestId,
          "audio/wav",
        ),
      ]);
      // A shape cut from another job's parts is never charged for them.
      if (
        !talking.sourceJobId &&
        ((talking.broll && !broll) || (talking.music && !music))
      ) {
        // An extra that did not come is taken off the charge before delivery.
        chargedCents = convertCreditsToCents(
          creditsPerTalkingVideo(
            talkingVideoModelForEndpoint(job.model),
            job.prompt,
            {
              siteShots: talking.siteShots,
              broll: broll !== null,
              music: music !== null,
            },
          ),
        );
        await prisma.projectImageJob.update({
          where: { id: job.id },
          data: { chargedCents },
          select: { id: true },
        });
      }
      const edited = await editTalkingVideo({
        shape: talking.shape,
        clip: downloaded.bytes,
        words: talking.words,
        clipSeconds: talking.durationSeconds,
        hookLine: talking.hookLine,
        ...(site ? { site } : {}),
        ...(endCard ? { endCard } : {}),
        ...(broll ? { broll } : {}),
        ...(music ? { music } : {}),
      });
      if (edited) {
        downloaded = { bytes: edited.bytes, contentType: "video/mp4" };
        editedSeconds = Math.ceil(edited.durationSeconds);
      } else if (onlyEdited(talking)) {
        throw new Error("The video had no words to time its cuts by.");
      }
    } catch (error) {
      // A video in any shape but vertical is only ever its edit: the
      // presenter's vertical clip would be the wrong shape. Nothing is
      // delivered, so nothing is charged.
      if (onlyEdited(talking)) {
        recordCoreWarning(
          {
            operation: "image_job_settle",
            imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
          },
          {
            message: "Could not cut a video in its shape",
            why: "Reading its parts or running the edit threw",
            fix: "The job is marked failed and nothing is charged. If this repeats, check Core's ffmpeg build and the studio's store.",
          },
        );
        await releaseSettlementLease(job.id, lease);
        await markImageJobFailed(job.id, "unknown");
        return;
      }
      // ffmpeg's output can name a caption, which is the script's words.
      recordCoreWarning(
        {
          operation: "image_job_settle",
          imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
        },
        {
          message: "Delivered a talking video without its edit",
          why: "Cutting and captioning the presenter clip threw",
          fix: "The video was kept as its presenter model made it. If this repeats, check that Core can fetch and run its ffmpeg build.",
        },
      );
    }
  }

  const backdrop = job.useProductCutout && !video ? downloaded : null;
  if (backdrop) {
    try {
      const cutout = await readProductCutout(job, project.organizationId);
      if (cutout.checksum !== job.productCutoutChecksum)
        throw unprocessableEntity(
          "The original product photo changed during generation.",
        );
      downloaded = await composeStudioProductCutout(
        downloaded.bytes,
        cutout.bytes,
        readSettings(job.settings).outputFormat,
      );
    } catch (error) {
      await releaseSettlementLease(job.id, lease);
      if (
        (error instanceof HTTPException &&
          (error.status === 404 || error.status === 422)) ||
        (error instanceof DriveFileDownloadError &&
          error.reason !== "unavailable")
      ) {
        await failImageJob(job.id, "product_cutout_unavailable");
      } else {
        await noteUnreachable(
          job.id,
          "Could not finish the product composition",
          "storage",
        );
      }
      return;
    }
  }

  const checksum = crypto
    .createHash("sha256")
    .update(downloaded.bytes)
    .digest("hex");
  // The provider first, because it knows without us guessing; then the image's own
  // header, which is what covers the endpoints that report nothing. `recraft/v3`
  // returns WebP with no dimensions and `luma-photon` reports none at all, and both
  // stored 0x0 until this read the bytes.
  // A video Core edited is its shape's frame, whatever the provider's clip was.
  const dimensions =
    (talking && editedSeconds !== null
      ? VIDEO_SHAPE_FRAMES[talking.shape]
      : null) ??
    (!job.useProductCutout && !vectorSource
      ? readProviderSize(mediaInfo)
      : null) ??
    (video ? null : readImageDimensionsFromBytes(downloaded.bytes));
  if (!dimensions && !video) {
    // Not a failure: the column holds 0 and the client falls back to the rendered
    // image's intrinsic size. Logged because a format nothing can read is worth
    // knowing about.
    recordCoreWarning(
      {
        operation: "image_job_settle",
        imageJobs: [
          {
            id: job.id,
            media: {
              contentType: loggableMediaType(downloaded.contentType),
              bytes: downloaded.bytes.byteLength,
            },
          },
        ],
      },
      {
        message: "Stored a generated image without dimensions",
        why: "Neither the provider nor the image header gave a width and height",
        fix: "The image works; clients use its rendered size. If one content type repeats, teach readImageDimensionsFromBytes that format.",
      },
    );
  }

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
  // objects were left behind with nothing referencing them. The finished image
  // and any separate backdrop use stable keys, overwritten idempotently. The
  // keys are not secrets, and nothing about access control rests on them.
  let blob: Awaited<ReturnType<typeof put>>;
  let backdropBlobPathname: string | undefined;
  try {
    const storageOptions = {
      access: "private" as const,
      token: studioBlobToken,
      addRandomSuffix: false,
      allowOverwrite: true,
    };
    const objectPath = `projects/${job.projectId}/image-studio/${job.id}`;
    if (vectorSource) {
      await put(`${objectPath}-source.svg`, Buffer.from(vectorSource), {
        ...storageOptions,
        contentType: "image/svg+xml",
        abortSignal: AbortSignal.timeout(60_000),
      });
    }
    if (backdrop) {
      const backdropHash = crypto
        .createHash("sha256")
        .update(backdrop.bytes)
        .digest("hex");
      const backdropBlob = await put(
        `${objectPath}-backdrop-${backdropHash.slice(0, 16)}`,
        backdrop.bytes as unknown as Buffer,
        {
          ...storageOptions,
          contentType: backdrop.contentType,
          abortSignal: AbortSignal.timeout(60_000),
        },
      );
      backdropBlobPathname = backdropBlob.pathname;
    }
    blob = await put(
      `${objectPath}-${checksum.slice(0, 16)}`,
      downloaded.bytes as unknown as Buffer,
      {
        ...storageOptions,
        contentType: downloaded.contentType,
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

  let delivered: {
    assetId: string;
    version: number | null;
    letteringJobId: string | null;
  };
  try {
    delivered = await insertAsset({
      job: {
        id: job.id,
        projectId: project.id,
        workspaceId: project.workspaceId,
        model: job.model,
        prompt: job.prompt,
        exportHeadline: job.exportHeadline,
        lettering: job.lettering,
        letteringQuoteCents: job.letteringQuoteCents,
        sessionId: job.sessionId,
        productId: job.productId,
        productName: job.productName,
        batchSlotId: job.batchSlotId,
        settings: job.settings,
        parentAssetId: job.parentAssetId,
        requestedByUserId: job.requestedByUserId,
        organizationId: project.organizationId,
        chargedCents,
      },
      aiGenerated: job.kind === ProjectImageJobKind.TALKING_VIDEO,
      blobPathname: blob.pathname,
      backdropBlobPathname,
      backdropContentType: backdrop?.contentType,
      contentType: downloaded.contentType,
      mediaType: video
        ? ProjectImageMediaType.VIDEO
        : ProjectImageMediaType.IMAGE,
      durationSeconds: video
        ? (editedSeconds ?? readVideoSettings(job.settings).durationSeconds)
        : null,
      width: dimensions?.width ?? 0,
      height: dimensions?.height ?? 0,
      bytes: downloaded.bytes.byteLength,
      checksum,
      // Every delivered video whose words were timed can be cut again, also
      // one delivered as its presenter clip after its own edit failed.
      ...(talking &&
      talking.shapes.length > 0 &&
      !talking.sourceJobId &&
      (short || talking.words.length > 0)
        ? { videoShapeJobs: videoShapeJobRows(job, talking) }
        : {}),
    });
  } catch (error) {
    if (isUniqueViolation(error)) return; // Another settler won; its asset stands.
    await releaseSettlementLease(job.id, lease);
    throw error;
  }
  // The next paid request is already durable. A crash here leaves a normal
  // PENDING row for recoverUnclaimedReservations, with the original quote.
  if (
    delivered.letteringJobId &&
    (await claimForSubmission(delivered.letteringJobId))
  ) {
    await sendClaimedJob(delivered.letteringJobId, project.organizationId);
  }
  if (job.batchSlotId && delivered.version !== null) {
    const replaced = await prisma.projectImageAsset
      .findFirst({
        where: {
          projectId: project.id,
          workspaceId: project.workspaceId,
          mediaType: ProjectImageMediaType.IMAGE,
          hiddenAt: null,
          version: { lt: delivered.version },
          job: {
            OR: [{ id: job.batchSlotId }, { batchSlotId: job.batchSlotId }],
          },
        },
        orderBy: { version: "desc" },
        select: { id: true },
      })
      .catch(() => null);
    if (replaced) {
      await recordStudioAdEvent({
        workspaceId: project.workspaceId,
        assetId: replaced.id,
        userId: job.requestedByUserId,
        type: "replaced_in_batch",
        meta: { jobId: job.id, batchSlotId: job.batchSlotId },
      });
    }
  }
  // Only the settler that stored the asset gets here, so this runs once per job.
  if (delivered.version !== null && !video) enqueueAdEval(job.id);
  await publishStudioAssetToFiles({
    assetId: delivered.assetId,
    jobId: job.id,
    workspaceId: project.workspaceId,
    organizationId: project.organizationId,
    userId: job.requestedByUserId,
    prompt: job.prompt,
    bytes: downloaded.bytes,
    contentType: downloaded.contentType,
  });
  // The outage this dependency was in ends here, not earlier: publishing the
  // asset clears every clock in the same transaction that records the success.
}

/**
 * The other shapes of a delivered video, one job each. They are cut from the
 * parts this job already paid for (voice, presenter, cut-out, B-roll, music),
 * so they cost nothing more and are free. Each is settled on its own by the
 * next reconcile (`settleVideoShapeJob`), so every edit has the whole time a
 * settlement gets. A job like this is the only talking video that runs
 * without a provider request of its own.
 */
function videoShapeJobRows(
  job: {
    id: string;
    projectId: string;
    workspaceId: string;
    requestedByUserId: string;
    kind: ProjectImageJobKind;
    model: string;
    prompt: string;
    voiceBlobPathname: string | null;
    pendingMediaUrl: string | null;
    presenterConsentAt: Date | null;
    sessionId: string | null;
    productId: string | null;
    productName: string | null;
  },
  talking: TalkingVideoSettings,
  shapes: readonly VideoShape[] = talking.shapes,
): Prisma.ProjectImageJobCreateManyInput[] {
  const now = new Date();
  return shapes.map((shape) => ({
    projectId: job.projectId,
    workspaceId: job.workspaceId,
    sessionId: job.sessionId,
    productId: job.productId,
    productName: job.productName,
    requestedByUserId: job.requestedByUserId,
    kind: job.kind,
    model: job.model,
    prompt: job.prompt,
    settings: jsonInput({
      ...talking,
      aspectRatio: shape,
      shape,
      shapes: [],
      sourceJobId: job.id,
    } satisfies TalkingVideoSettings),
    referenceAssetIds: [],
    idempotencyKey: videoShapeJobKey(job.id, shape),
    status: ProjectImageJobStatus.RUNNING,
    chargedCents: 0n,
    submittedAt: now,
    voiceBlobPathname: job.voiceBlobPathname,
    pendingMediaUrl: job.pendingMediaUrl,
    presenterConsentAt: job.presenterConsentAt,
  }));
}

/**
 * Asks for one more shape of a delivered video, cut from its parts at no
 * cost, as a job of its own (`video-shape:<source>:<shape>`). False when the
 * video cannot be cut again: not delivered, delivered without Core's edit
 * (its words were never timed), or itself a shape of another video.
 */
export async function requestVideoShape(
  sourceJobId: string,
  shape: VideoShape,
): Promise<boolean> {
  const job = await prisma.projectImageJob.findUnique({
    where: { id: sourceJobId },
    select: {
      id: true,
      projectId: true,
      workspaceId: true,
      requestedByUserId: true,
      kind: true,
      model: true,
      prompt: true,
      status: true,
      settings: true,
      voiceBlobPathname: true,
      pendingMediaUrl: true,
      presenterConsentAt: true,
      sessionId: true,
      productId: true,
      productName: true,
    },
  });
  if (
    job?.kind !== ProjectImageJobKind.TALKING_VIDEO ||
    job.status !== ProjectImageJobStatus.SUCCEEDED
  )
    return false;
  const talking = readTalkingVideoSettings(job.settings);
  if (talking.sourceJobId || (!talking.format && talking.words.length === 0))
    return false;
  if (talking.shape !== shape)
    await prisma.projectImageJob.createMany({
      data: videoShapeJobRows(job, talking, [shape]),
      skipDuplicates: true,
    });
  return true;
}

/**
 * Cut one shape job from its source's parts: the source's last provider
 * result (presenter clip, cut-out or music) is read again and edited in this
 * job's shape. A source that did not deliver takes its shapes with it.
 */
async function settleVideoShapeJob(job: {
  id: string;
  settings: Prisma.JsonValue;
}): Promise<void> {
  const { sourceJobId } = readTalkingVideoSettings(job.settings);
  if (!sourceJobId) return;
  const source = await prisma.projectImageJob.findUnique({
    where: { id: sourceJobId },
    select: {
      status: true,
      model: true,
      falRequestId: true,
      pendingMediaUrl: true,
      settings: true,
    },
  });
  if (
    source?.status !== ProjectImageJobStatus.SUCCEEDED ||
    !source.falRequestId
  ) {
    if (
      !source ||
      !(LIVE_STATUSES as readonly string[]).includes(source.status)
    )
      await markImageJobFailed(job.id, "unknown");
    return;
  }
  const result = await fetchQueueResult({
    model: queueModel(source),
    requestId: source.falRequestId,
  });
  if (result.kind === "pending") return;
  if (result.kind === "unreachable") {
    await noteUnreachable(job.id, result.message, "result");
    return;
  }
  if (result.kind === "error") {
    // The source's last request was an optional step (its cut-out) that
    // failed; it was delivered from its presenter clip, and so is this.
    if (source.pendingMediaUrl)
      await storeMedia(job.id, source.pendingMediaUrl);
    else await markImageJobFailed(job.id, "provider_error", result.message);
    return;
  }
  await storeMedia(
    job.id,
    result.media[0]!.url,
    undefined,
    source.falRequestId,
  );
  nudgeCmoMonth(job.id);
}

/**
 * Insert the version, take its number, and take the money.
 *
 * Version allocation is a read-then-write, so it runs serializable and the
 * `(rootId, version)` unique index backs it up: if two settlements in one lineage
 * still collide, the loser aborts and the helper retries it against a count that
 * now includes the winner.
 *
 * **This is the only place the studio charges for an image.** It is the right place
 * because it is already exactly-once per job: it early-returns on an existing asset
 * for this job, `ProjectImageAsset.jobId` is unique, it runs serializable, and the
 * caller treats a unique violation as "another settler won". A debit placed inside
 * it inherits all of that, so however many webhooks, polls and cron sweeps race one
 * job, the person is charged once.
 */
async function insertAsset(input: {
  job: {
    id: string;
    projectId: string;
    workspaceId: string;
    model: string;
    prompt: string;
    exportHeadline: string | null;
    lettering?: string;
    letteringQuoteCents?: bigint | null;
    sessionId: string | null;
    productId: string | null;
    productName: string | null;
    batchSlotId?: string | null;
    settings: Prisma.JsonValue;
    parentAssetId: string | null;
    /** Who pays, and out of which pot. */
    requestedByUserId: string;
    organizationId: string | null;
    /** The quote written at submit. What gets taken here. */
    chargedCents: bigint | null;
  };
  aiGenerated: boolean;
  blobPathname: string;
  backdropBlobPathname?: string;
  backdropContentType?: string;
  contentType: string;
  mediaType: ProjectImageMediaType;
  durationSeconds: number | null;
  width: number;
  height: number;
  bytes: number;
  checksum: string;
  /**
   * A video's other shapes, reserved with its asset: a delivered video never
   * loses them to a failure after it was stored and charged.
   */
  videoShapeJobs?: Prisma.ProjectImageJobCreateManyInput[];
}): Promise<{
  assetId: string;
  version: number | null;
  letteringJobId: string | null;
}> {
  return await serializableTransaction(async (tx) => {
    const existing = await tx.projectImageAsset.findUnique({
      where: { jobId: input.job.id },
      select: { id: true },
    });
    if (existing)
      return { assetId: existing.id, version: null, letteringJobId: null };

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
    const version = (highest?.version ?? 0) + 1;

    // The charge. Quoted at submit, taken here, once.
    //
    // A shortfall must never cost somebody an image the platform has already paid
    // fal for. `prepareConsumption` cannot overdraw — it throws rather than letting
    // a balance go negative — so if the balance fell between submit and delivery the
    // debit fails, and letting that failure escape would abort this transaction,
    // leave the asset unwritten, and make settlement retry an image it can never
    // store. The image is kept and given away instead.
    //
    // `chargedCents` then has to become 0, not stay at the quote: the history
    // trigger reads it, and a row reporting a charge with no transaction behind it
    // is the feed lying about money. Zero is the true number.
    let chargedCents = input.job.chargedCents ?? 0n;
    let transactionId: string | null = null;
    if (chargedCents > 0n) {
      try {
        transactionId = await createTaskEventTransaction({
          userId: input.job.requestedByUserId,
          organizationId: input.job.organizationId,
          projectId: input.job.projectId,
          cents: chargedCents,
          scope: createNetworkScope("mainnet"),
          tx,
        });
      } catch (error) {
        // Only a shortfall is survivable. Anything else — a pool timeout, a
        // serialization failure — is transient, and rethrowing lets the settler
        // retry the whole thing rather than silently giving an image away.
        if (!isInsufficientBalanceError(error)) throw error;
        recordCoreError(
          {
            operation: "image_job_settle",
            // The requester lives on the job entry: a poll's own user.id is
            // the reader, and several jobs can settle on one event.
            imageJobs: [
              {
                id: input.job.id,
                quotedCents: chargedCents.toString(),
                requestedByUserId: input.job.requestedByUserId,
                organizationId: input.job.organizationId,
              },
            ],
          },
          {
            message: "Delivered a generated image without charging for it",
            why: "The balance no longer covered the quote when the image was stored",
            fix: "The image was kept and the charge dropped. If this repeats, check why reservations no longer hold the quoted credits.",
          },
        );
        chargedCents = 0n;
        transactionId = null;
      }
    }

    await tx.projectImageAsset.create({
      data: {
        id,
        projectId: input.job.projectId,
        workspaceId: input.job.workspaceId,
        jobId: input.job.id,
        rootId: family,
        parentId: rootId ? input.job.parentAssetId : null,
        version,
        model: input.job.model,
        prompt: input.job.prompt,
        settings: input.job.settings ?? {},
        blobPathname: input.blobPathname,
        ...(input.backdropBlobPathname !== undefined
          ? { backdropBlobPathname: input.backdropBlobPathname }
          : {}),
        ...(input.backdropContentType !== undefined
          ? { backdropContentType: input.backdropContentType }
          : {}),
        contentType: input.contentType,
        mediaType: input.mediaType,
        aiGenerated: input.aiGenerated,
        durationSeconds: input.durationSeconds,
        width: input.width,
        height: input.height,
        bytes: input.bytes,
        checksum: input.checksum,
        ...(input.job.exportHeadline &&
        input.job.letteringQuoteCents == null &&
        input.mediaType === ProjectImageMediaType.IMAGE
          ? { headline: { create: { text: input.job.exportHeadline } } }
          : {}),
      },
    });
    if (input.videoShapeJobs?.length)
      await tx.projectImageJob.createMany({
        data: input.videoShapeJobs,
        skipDuplicates: true,
      });

    let letteringJobId: string | null = null;
    if (
      input.job.lettering === "ideogram" &&
      input.job.letteringQuoteCents != null &&
      input.job.exportHeadline
    ) {
      const rawSettings = input.job.settings;
      const secondSettings =
        rawSettings &&
        typeof rawSettings === "object" &&
        !Array.isArray(rawSettings)
          ? rawSettings.letteringSettings
          : null;
      const secondModel =
        rawSettings &&
        typeof rawSettings === "object" &&
        !Array.isArray(rawSettings) &&
        typeof rawSettings.letteringModel === "string"
          ? rawSettings.letteringModel
          : "";
      const letteringJob = await tx.projectImageJob.create({
        data: {
          projectId: input.job.projectId,
          workspaceId: input.job.workspaceId,
          sessionId: input.job.sessionId,
          requestedByUserId: input.job.requestedByUserId,
          kind: ProjectImageJobKind.EDIT,
          model: secondModel,
          prompt: `Add the approved headline: ${input.job.exportHeadline}`,
          exportHeadline: input.job.exportHeadline,
          lettering: "ideogram",
          settings: jsonInput(readSettings(secondSettings ?? {})),
          productId: input.job.productId,
          productName: input.job.productName,
          batchSlotId: input.job.batchSlotId ?? input.job.id,
          parentAssetId: id,
          referenceAssetIds: [id],
          referenceFileIds: [],
          idempotencyKey: `studio-lettering:${input.job.id}`,
          status: ProjectImageJobStatus.PENDING,
          chargedCents: input.job.letteringQuoteCents,
        },
      });
      letteringJobId = letteringJob.id;
    }

    await tx.projectImageJob.updateMany({
      where: { id: input.job.id },
      data: {
        status: ProjectImageJobStatus.SUCCEEDED,
        settledAt: new Date(),
        error: null,
        failureReason: null,
        settleLeaseAt: null,
        settleLeaseOwner: null,
        // What was actually taken, which is the quote unless the balance had moved.
        chargedCents,
        transactionId,
        // The job is done; no dependency is still owed a read.
        statusUnreachableSince: null,
        resultUnreachableSince: null,
        authUnreachableSince: null,
        unreachableSource: null,
      },
    });
    return { assetId: id, version, letteringJobId };
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
    // Recovery sends prompts to the provider, whose errors can quote them.
    recordCoreWarning(
      {
        operation: "image_job_reconcile",
        project: { id: projectId },
        failure: messageSafeErrorFields(error),
      },
      {
        message: "Could not recover stranded image reservations for a project",
        why: "Recovering unclaimed reservations threw",
        fix: "Nothing is lost: the next poll or the image-jobs sync tries again.",
      },
    );
  });
  const pending = await prisma.projectImageJob.findMany({
    where: { projectId, ...recoverableSelection() },
    orderBy: { createdAt: "asc" },
    take: LIMITS.IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT,
    select: { id: true },
  });
  const shape = await nextVideoShape({ projectId }, { createdAt: "asc" });
  // Sequential: these are the same small set the project is limited to, and a
  // burst of provider reads from one page load buys nothing.
  for (const job of [...pending, ...shape]) {
    try {
      await reconcileJob(job.id);
    } catch (error) {
      // Provider reads and settlement errors can quote the prompt.
      // An array: evlog appends it, so each failed job keeps its own entry
      // when one poll fails several on the request's event.
      recordCoreWarning(
        {
          operation: "image_job_reconcile",
          imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
        },
        {
          message: "Could not reconcile an image job",
          why: "Asking the provider for the job's outcome or settling it threw",
          fix: "The job stays live; the next poll or the image-jobs sync tries again.",
        },
      );
    }
  }
}

const WORKSPACE_RECONCILE_PROJECTS = 5;

/**
 * `reconcileProjectJobs` for every workspace project with work in flight.
 *
 * Capped, because the workspace view polls this: a workspace with many busy
 * projects settles a few per poll rather than making every provider call at
 * once. The cron sweep catches whatever this leaves.
 */
export async function reconcileWorkspaceJobs(
  workspaceId: string,
): Promise<void> {
  const projects = await prisma.projectImageJob.findMany({
    where: {
      project: { workspaceId },
      OR: [recoverableSelection(), videoShapeSelection()],
    },
    distinct: ["projectId"],
    take: WORKSPACE_RECONCILE_PROJECTS,
    select: { projectId: true },
  });
  for (const { projectId } of projects) {
    await reconcileProjectJobs(projectId);
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
      ...recoverableSelection(),
      updatedAt: { lt: new Date(Date.now() - options.olderThanMs) },
    },
    orderBy: { updatedAt: "asc" },
    take: options.limit,
    select: { id: true },
  });
  // A shape is cut on the next sweep, stale or not: no provider will call back.
  const shape = await nextVideoShape({}, { createdAt: "asc" });
  let reconciled = 0;
  for (const job of [...stale, ...shape]) {
    try {
      await reconcileJob(job.id);
      reconciled += 1;
    } catch (error) {
      recordCoreWarning(
        {
          operation: "image_job_reconcile",
          imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
        },
        {
          message: "Could not reconcile a stale image job",
          why: "Asking the provider for the job's outcome or settling it threw",
          fix: "The job stays live; the next image-jobs sync tries again.",
        },
      );
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
    model: queueModel(job),
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
    select: {
      id: true,
      model: true,
      pendingMediaUrl: true,
      settings: true,
      falRequestId: true,
    },
  });

  let finalised = 0;
  for (const job of requested) {
    if (!job.falRequestId) continue;
    const status = await fetchQueueStatus({
      model: queueModel(job),
      requestId: job.falRequestId,
    });
    // Unreachable says nothing; leave it for the next pass.
    if (status.kind === "unreachable") continue;
    if (status.kind === "not_found") {
      if (await deliverUncaptionedTalkingVideo(job.id)) continue;
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
      abandoned += released.count;
      continue;
    }

    // Recovery buys an image, so it needs the same permission the original
    // request needed — and it runs minutes later, with no request context, so
    // it has to ask again. Without this, a reservation left behind by someone
    // since removed from the organization was still sent to the provider and
    // charged.
    let access: ProjectAccess | null = null;
    try {
      access = await requireProjectAccessForUser({
        projectId: job.projectId,
        userId: job.requestedByUserId,
      });
    } catch (error) {
      if (!isAccessDenied(error)) {
        // Could not ask. Leave the row alone and try on the next sweep;
        // failing to check is not the same as being refused.
        // The failure rides on the job's own entry: a cause in warnings[]
        // could not be matched to its job once a poll logs several.
        recordCoreWarning(
          {
            operation: "image_job_recovery",
            imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
          },
          {
            message:
              "Could not check access before recovering an image reservation",
            why: "The project access check failed without an answer",
            fix: "The reservation is left alone and the next sweep checks again. If it repeats, look up the error name and code on its imageJobs entry.",
          },
        );
        continue;
      }
    }

    if (!access) {
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
      denied += released.count;
      continue;
    }

    if (!(await claimForSubmission(job.id))) continue;
    try {
      await sendClaimedJob(job.id, access.organizationId);
      submitted += 1;
    } catch (error) {
      // Sending builds the prompt, which its errors can quote.
      recordCoreWarning(
        {
          operation: "image_job_recovery",
          imageJobs: [{ id: job.id, failure: messageSafeErrorFields(error) }],
        },
        {
          message: "Could not send a recovered image reservation",
          why: "Submitting the claimed job to the provider threw",
          fix: "The job keeps its claim and the stalled-submission sweep resolves it. If this repeats, look up the error name and code under failure.",
        },
      );
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
 * The provider's own figures, when they are usable.
 *
 * fal sends `null` for endpoints that do not report a size, and the shape allows
 * anything, so this is where a half-reported size (a width with no height) is
 * rejected rather than stored as `1024x0`.
 */
function readProviderSize(
  size: { width: number | null; height: number | null } | undefined,
): { width: number; height: number } | null {
  if (!size) return null;
  const { width, height } = size;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

export { readProviderSize, readSettings };
