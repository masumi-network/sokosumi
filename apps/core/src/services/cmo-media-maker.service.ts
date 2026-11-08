import { createHash } from "node:crypto";

import { ProjectImageJobStatus } from "@sokosumi/database";
import type { CmoCalendarEntry } from "@sokosumi/soko-bot";
import { CMO_CHANNELS, socialPostMediaKindForMime } from "@sokosumi/utils";
import { head } from "@vercel/blob";
import { HTTPException } from "hono/http-exception";

import { LIMITS } from "@/config/constants";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import prisma from "@/lib/db/prisma";
import { imageModel } from "@/lib/image-studio/catalog";
import { ensureImageCatalogFresh } from "@/lib/image-studio/fal-catalog-refresh";
import { DEFAULT_ANIMATE_MODEL_ID } from "@/lib/image-studio/video-model";
import { listCmoBrandPictures } from "@/services/cmo-brand-media.service";
import type { Cuso } from "@/services/cmo-cuso.service";
import { cusoDrive } from "@/services/cuso-project-files.service";
import { ensureStudioAssetDriveFile } from "@/services/image-studio-drive.service";
import {
  createImageJob,
  createVideoJob,
  DEFAULT_SETTINGS,
} from "@/services/image-studio-jobs.service";
import {
  scheduleSocialPost,
  updateSocialPost,
} from "@/services/social-posts.service";

/**
 * Core makes the month's pictures and videos. Cuso writes each piece's
 * visual (what it shows, and the brand pictures it is made from); Core
 * starts every picture once, within the studio's limit of three at a time,
 * puts it on its post and schedules the post on a connected network. Runs
 * that made their own media bought 25 files for 14 pieces and put one
 * picture on three posts. Each job's key names its piece, slot and visual,
 * so two callers racing start the same job, and a new visual starts over.
 */

const KEY_PREFIX = "cmo-media";
/** Tries a slot gets for one visual before the piece goes back to Cuso. */
const ATTEMPTS = 2;
/** Default references when the visual names none: the brand's own pictures. */
const DEFAULT_REFERENCES = 2;

const LIVE = new Set<ProjectImageJobStatus>([
  ProjectImageJobStatus.PENDING,
  ProjectImageJobStatus.SUBMITTING,
  ProjectImageJobStatus.QUEUED,
  ProjectImageJobStatus.RUNNING,
  ProjectImageJobStatus.SUBMISSION_UNCERTAIN,
]);

type Format = {
  name?: string;
  image: boolean;
  video?: boolean;
  slides?: readonly [number, number];
};
type Channel = { name?: string; formats: Record<string, Format> };

function formatOf(entry: Pick<CmoCalendarEntry, "channel" | "format">) {
  return (CMO_CHANNELS as Record<string, Channel>)[entry.channel]?.formats[
    entry.format
  ];
}

/** Whether the piece's format comes with an image or video Core makes. */
export function cmoPieceNeedsMedia(
  entry: Pick<CmoCalendarEntry, "channel" | "format">,
): boolean {
  const format = formatOf(entry);
  return Boolean(format?.image || format?.video);
}

/**
 * A carousel's slides: as many as Cuso described, within its format's range;
 * 0 for a single-image format.
 */
export function cmoPieceSlides(
  entry: Pick<CmoCalendarEntry, "channel" | "format" | "slides">,
): number {
  const range = formatOf(entry)?.slides;
  if (!range) return 0;
  return Math.min(range[1], Math.max(range[0], entry.slides?.length ?? 0));
}

function isVideo(entry: Pick<CmoCalendarEntry, "channel" | "format">) {
  return Boolean(formatOf(entry)?.video);
}

/** A piece as the media maker reads it. */
export interface CmoMediaPiece
  extends Pick<
    CmoCalendarEntry,
    | "id"
    | "channel"
    | "format"
    | "status"
    | "title"
    | "visual"
    | "visualFileIds"
    | "slides"
    | "socialPostId"
  > {
  /** What is on it already: a post's file pathnames, a file piece's file ids. */
  media: readonly string[];
}

/** One studio job Core started for a piece. */
export interface CmoMediaJob {
  id: string;
  pieceId: string;
  slot: number;
  step: "image" | "still" | "video";
  visualKey: string;
  status: ProjectImageJobStatus;
  assetId: string | null;
  prompt: string;
}

/** Where a piece's media stands. */
export type CmoMediaState =
  /** Every slot is on the piece. */
  | "made"
  /** Core is making or attaching it. */
  | "making"
  /** No visual yet: Cuso writes one. */
  | "no_visual"
  /** A slot failed twice for this visual: Cuso writes another. */
  | "failed";

/** What one slot needs next. */
export type CmoSlotAction =
  | { kind: "attach"; job: CmoMediaJob }
  | { kind: "wait" }
  | { kind: "failed" }
  | {
      kind: "start";
      step: CmoMediaJob["step"];
      attempt: number;
      sourceAssetId: string | null;
    };

/** The visual and its pictures, as one short key: a new visual starts over. */
export function cmoVisualKey(
  piece: Pick<CmoMediaPiece, "visual" | "visualFileIds" | "slides">,
): string {
  return createHash("sha256")
    .update(
      `${piece.visual ?? ""}|${(piece.visualFileIds ?? []).join(",")}${piece.slides?.length ? `|${piece.slides.join("|")}` : ""}`,
    )
    .digest("hex")
    .slice(0, 10);
}

/** Slots a piece shows: its slides, or one picture or video. */
function slotsOf(piece: CmoMediaPiece): number {
  return Math.max(1, cmoPieceSlides(piece));
}

/** A slot's next step, from the jobs started for it under the current visual. */
export function cmoSlotAction(
  piece: CmoMediaPiece,
  jobs: readonly CmoMediaJob[],
): CmoSlotAction {
  const next = (
    name: CmoMediaJob["step"],
    sourceAssetId: string | null,
  ): CmoSlotAction => {
    const tried = jobs.filter((job) => job.step === name);
    const last = tried.at(-1);
    if (last && LIVE.has(last.status)) return { kind: "wait" };
    if (last?.status === ProjectImageJobStatus.SUCCEEDED && last.assetId)
      return { kind: "attach", job: last };
    if (tried.length >= ATTEMPTS) return { kind: "failed" };
    return {
      kind: "start",
      step: name,
      attempt: tried.length + 1,
      sourceAssetId,
    };
  };
  if (!isVideo(piece)) return next("image", null);
  // A video animates a still made from the brand's own pictures: the still
  // first, then the video from it, each retried on its own.
  const still = next("still", null);
  if (still.kind !== "attach") return still;
  return next("video", still.job.assetId);
}

/** Where a piece's media stands, without changing anything. */
export function cmoMediaState(
  piece: CmoMediaPiece,
  jobs: readonly CmoMediaJob[],
): CmoMediaState {
  if (!cmoPieceNeedsMedia(piece) || piece.media.length >= slotsOf(piece))
    return "made";
  if (!piece.visual?.trim()) return "no_visual";
  const key = cmoVisualKey(piece);
  for (let slot = piece.media.length; slot < slotsOf(piece); slot += 1) {
    const action = cmoSlotAction(
      piece,
      jobs.filter(
        (job) =>
          job.pieceId === piece.id &&
          job.slot === slot &&
          job.visualKey === key,
      ),
    );
    if (action.kind === "failed") return "failed";
  }
  return "making";
}

function jobKey(
  versionId: string,
  piece: CmoMediaPiece,
  slot: number,
  step: CmoMediaJob["step"],
  attempt: number,
): string {
  return [
    KEY_PREFIX,
    versionId,
    piece.id,
    slot,
    step,
    cmoVisualKey(piece),
    attempt,
  ].join(":");
}

/** Core's media jobs for a version, oldest first. */
export async function listCmoMediaJobs(
  projectId: string,
  versionId: string,
): Promise<CmoMediaJob[]> {
  const rows = await prisma.projectImageJob.findMany({
    where: {
      projectId,
      idempotencyKey: { startsWith: `${KEY_PREFIX}:${versionId}:` },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      idempotencyKey: true,
      status: true,
      prompt: true,
      asset: { select: { id: true } },
    },
  });
  return rows.flatMap((row) => {
    const [, , pieceId, slot, step, visualKey] = row.idempotencyKey.split(":");
    if (
      !pieceId ||
      !visualKey ||
      (step !== "image" && step !== "still" && step !== "video")
    )
      return [];
    return [
      {
        id: row.id,
        pieceId,
        slot: Number(slot),
        step,
        visualKey,
        status: row.status,
        assetId: row.asset?.id ?? null,
        prompt: row.prompt,
      },
    ];
  });
}

/** The aspect ratio a network shows this piece at. */
function aspectRatio(piece: CmoMediaPiece): string {
  if (isVideo(piece) || /story|reel|short/.test(piece.format)) return "9:16";
  if (piece.channel === "instagram" || piece.channel === "facebook")
    return piece.format === "carousel_ad" ? "1:1" : "4:5";
  if (piece.channel === "linkedin") return "4:5";
  if (piece.channel === "meta_ads")
    return piece.format === "carousel_ad" ? "1:1" : "4:5";
  return "16:9";
}

/** The picture's prompt: the visual, the slide it is, and the brand pictures it keeps. */
export function cmoImagePrompt(input: {
  piece: CmoMediaPiece;
  slot: number;
  businessName: string;
  references: number;
}): string {
  const { piece, slot } = input;
  const channel = (CMO_CHANNELS as Record<string, Channel>)[piece.channel];
  const slides = cmoPieceSlides(piece);
  const slide = piece.slides?.[slot]?.trim();
  const words =
    piece.format === "quote_card" || slides > 0
      ? "Any words in the picture are short, spelled exactly as given."
      : "No words, letters, numbers or logos in the picture.";
  return [
    piece.visual?.trim() ?? piece.title,
    slides > 0
      ? `Slide ${slot + 1} of ${slides} of one ${channel?.name ?? piece.channel} carousel: every slide in the same style and colours${slot === 0 ? "; this first slide is the hook" : ", each showing a different view"}.${slide ? ` This slide: ${slide}` : ""}`
      : "",
    isVideo(piece)
      ? "A vertical still with one clear subject and room to move: it becomes a five-second video."
      : "",
    input.references > 0
      ? `Made for ${input.businessName} from the reference pictures: keep what they show of the brand (its product, its screens, its colours and logo) exactly, and change the setting, the framing and the light.`
      : `Made for ${input.businessName}.`,
    words,
    "Never a real, named person.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The pictures a visual is made from: those it names, else the brand's own. */
function references(
  piece: CmoMediaPiece,
  brandPictures: readonly { fileId: string; alt: string }[],
): string[] {
  const known = new Set(brandPictures.map((picture) => picture.fileId));
  const named = (piece.visualFileIds ?? []).filter((id) => known.has(id));
  if (named.length > 0) return named;
  const photos = brandPictures.filter(
    (picture) => !picture.alt.endsWith("page screenshot"),
  );
  const home = brandPictures.find((picture) => picture.alt.startsWith("Home"));
  return [...photos.slice(0, 1), ...(home ? [home] : []), ...photos.slice(1)]
    .slice(0, DEFAULT_REFERENCES)
    .map((picture) => picture.fileId);
}

interface MediaContext {
  cuso: Pick<Cuso, "projectId" | "workspaceId" | "sokoBotId" | "businessName">;
  versionId: string;
  connected: ReadonlySet<string>;
}

/**
 * Moves every piece's media on: attaches what is ready, starts what is
 * missing within the studio's limit, and schedules a post once it has its
 * media on a connected network. Safe to call any time and from anywhere.
 */
export async function advanceCmoMedia(
  context: MediaContext,
  pieces: readonly CmoMediaPiece[],
): Promise<void> {
  const wanted = pieces.filter(
    (piece) =>
      piece.status !== "published" &&
      piece.status !== "skipped" &&
      piece.visual?.trim() &&
      cmoMediaState(piece, []) !== "made",
  );
  // A post whose words changed after its picture went on is back to a
  // draft; nothing else schedules a post with a picture.
  const unscheduled = pieces.filter(
    (piece) =>
      piece.socialPostId &&
      piece.status === "draft" &&
      context.connected.has(piece.channel) &&
      cmoPieceNeedsMedia(piece) &&
      cmoMediaState(piece, []) === "made",
  );
  if (wanted.length === 0 && unscheduled.length === 0) return;
  const drive = await cusoDrive(context.cuso);
  if (!drive) return;
  for (const piece of unscheduled)
    await scheduleWhenComplete(context, drive, piece);
  if (wanted.length === 0) return;
  const { projectId } = context.cuso;
  const jobs = await listCmoMediaJobs(projectId, context.versionId);
  let capacity =
    LIMITS.IMAGE_STUDIO_CONCURRENT_JOBS_PER_PROJECT -
    (await prisma.projectImageJob.count({
      where: { projectId, status: { in: [...LIVE] } },
    }));
  let brandPictures: { fileId: string; alt: string }[] | null = null;
  for (const piece of wanted) {
    const key = cmoVisualKey(piece);
    // Slides go on in order, so the next one missing is always slot
    // media.length: a carousel once attached slides 2 and 3 while its cover
    // failed, and the cover was never tried again or handed back to Cuso.
    let inOrder = true;
    for (let slot = piece.media.length; slot < slotsOf(piece); slot += 1) {
      const action = cmoSlotAction(
        piece,
        jobs.filter(
          (job) =>
            job.pieceId === piece.id &&
            job.slot === slot &&
            job.visualKey === key,
        ),
      );
      if (action.kind === "attach") {
        if (inOrder) inOrder = await attach(context, drive, piece, action.job);
        continue;
      }
      inOrder = false;
      if (action.kind !== "start" || capacity <= 0) continue;
      brandPictures ??= await listCmoBrandPictures(projectId);
      const started = await start(context, drive, {
        piece,
        slot,
        action,
        references:
          action.step === "video" ? [] : references(piece, brandPictures),
      });
      // A refusal (credits, the hourly limit) stops starting, never
      // attaching: finished pictures further down still go on their posts.
      capacity = started ? capacity - 1 : 0;
    }
  }
}

/** Starts one job; false when the studio refused (credits, the limit). */
async function start(
  context: MediaContext,
  drive: { workspaceId: string; userId: string },
  input: {
    piece: CmoMediaPiece;
    slot: number;
    action: Extract<CmoSlotAction, { kind: "start" }>;
    references: string[];
  },
): Promise<boolean> {
  const { piece, slot, action } = input;
  const idempotencyKey = jobKey(
    context.versionId,
    piece,
    slot,
    action.step,
    action.attempt,
  );
  const scope = {
    projectId: context.cuso.projectId,
    workspaceId: drive.workspaceId,
    userId: drive.userId,
    sessionId: null,
    idempotencyKey,
  };
  try {
    if (action.step === "video") {
      if (!action.sourceAssetId) return true;
      await createVideoJob({
        ...scope,
        prompt: `Bring this picture to life for five seconds with gentle, realistic movement: ${piece.visual?.trim() ?? piece.title}. No words.`,
        modelId: DEFAULT_ANIMATE_MODEL_ID,
        settings: { durationSeconds: 5 },
        sourceAssetId: action.sourceAssetId,
      });
      return true;
    }
    await ensureImageCatalogFresh();
    const model = imageModel();
    await createImageJob({
      ...scope,
      prompt: cmoImagePrompt({
        piece,
        slot,
        businessName: context.cuso.businessName,
        references: input.references.length,
      }),
      modelId: model.id,
      settings: {
        ...DEFAULT_SETTINGS,
        ...(model.outputFormats.includes("jpeg")
          ? { outputFormat: "jpeg" }
          : {}),
        aspectRatio: aspectRatio(piece),
      },
      referenceAssetIds: [],
      referenceFileIds: input.references,
      parentAssetId: null,
    });
    return true;
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error;
    console.warn("CMO media could not start", {
      sokoBotId: context.cuso.sokoBotId,
      pieceId: piece.id,
      error: error.message,
    });
    return false;
  }
}

/**
 * Puts a finished picture or video on its piece, then schedules a complete
 * post. True once the file is on the piece.
 */
async function attach(
  context: MediaContext,
  drive: { workspaceId: string; organizationId: string | null; userId: string },
  piece: CmoMediaPiece,
  job: CmoMediaJob,
): Promise<boolean> {
  if (!job.assetId) return false;
  const file = await ensureStudioAssetDriveFile({
    projectId: context.cuso.projectId,
    assetId: job.assetId,
    workspaceId: drive.workspaceId,
    organizationId: drive.organizationId,
    userId: drive.userId,
    prompt: job.prompt,
    jobId: job.id,
  });
  if (!file) return false;
  if (!piece.socialPostId) {
    await prisma.marketingStrategyFile.updateMany({
      where: {
        marketingStrategyId: context.versionId,
        entryId: piece.id,
        NOT: { mediaFileIds: { has: file.id } },
      },
      data: { mediaFileIds: { push: file.id } },
    });
    return true;
  }
  const post = await prisma.socialPost.findUnique({
    where: { id: piece.socialPostId },
    select: {
      id: true,
      provider: true,
      text: true,
      media: true,
      revision: true,
      status: true,
      scheduledAt: true,
      planning: true,
    },
  });
  if (!post || post.status !== "DRAFT") return false;
  const media = parseSocialPostMedia(post.media, post.id);
  if (media.some((item) => item.pathname === file.pathname)) return true;
  const kind = socialPostMediaKindForMime(file.mimeType);
  if (!kind) return false;
  const scope = {
    postId: post.id,
    projectId: context.cuso.projectId,
    workspaceId: drive.workspaceId,
    userId: drive.userId,
    organizationId: drive.organizationId,
  };
  const updated = await updateSocialPost({
    ...scope,
    revision: post.revision,
    media: [
      ...media,
      {
        pathname: file.pathname,
        fileUrl: (await head(file.pathname)).url,
        name: file.name,
        size: file.size,
        mimeType: file.mimeType,
        kind,
      },
    ],
  });
  if (updated.media.length >= slotsOf(piece))
    await schedule(context, scope, { ...post, revision: updated.revision });
  return true;
}

/** Schedules a draft post that has all its pictures, on a connected network. */
async function scheduleWhenComplete(
  context: MediaContext,
  drive: { workspaceId: string; organizationId: string | null; userId: string },
  piece: CmoMediaPiece,
): Promise<void> {
  if (!piece.socialPostId) return;
  const post = await prisma.socialPost.findUnique({
    where: { id: piece.socialPostId },
    select: {
      id: true,
      provider: true,
      text: true,
      revision: true,
      status: true,
      scheduledAt: true,
      planning: true,
    },
  });
  if (!post || post.status !== "DRAFT") return;
  await schedule(
    context,
    {
      postId: post.id,
      projectId: context.cuso.projectId,
      workspaceId: drive.workspaceId,
      userId: drive.userId,
      organizationId: drive.organizationId,
    },
    post,
  );
}

/** Schedules a written post at its planned time on a connected network. */
async function schedule(
  context: MediaContext,
  scope: {
    postId: string;
    projectId: string;
    workspaceId: string;
    userId: string;
    organizationId: string | null;
  },
  post: {
    id: string;
    provider: string;
    text: string;
    revision: number;
    scheduledAt: Date | null;
    planning: unknown;
  },
): Promise<void> {
  const planning = post.planning as { brief?: unknown; title?: unknown };
  const written =
    post.text.trim() !== "" &&
    post.text !== planning?.brief &&
    post.text !== planning?.title;
  if (
    !written ||
    !context.connected.has(post.provider) ||
    !post.scheduledAt ||
    post.scheduledAt.getTime() <= Date.now()
  )
    return;
  await scheduleSocialPost({
    ...scope,
    revision: post.revision,
    scheduledAt: post.scheduledAt,
  }).catch((error: unknown) => {
    if (!(error instanceof HTTPException)) throw error;
    console.warn("CMO media could not schedule a post", {
      postId: post.id,
      error: error.message,
    });
  });
}

/** A Core media job settled: the month it belongs to moves on. */
export function isCmoMediaJob(idempotencyKey: string): boolean {
  return idempotencyKey.startsWith(`${KEY_PREFIX}:`);
}
