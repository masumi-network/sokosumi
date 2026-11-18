import { createHash } from "node:crypto";

import { ProjectImageJobStatus } from "@sokosumi/database";
import {
  type CmoCalendarEntry,
  SOKO_BOT_VOICEOVER_VOICES,
} from "@sokosumi/soko-bot";
import {
  CMO_CHANNELS,
  isCmoTalkingFormat,
  socialPostMediaKindForMime,
} from "@sokosumi/utils";
import { head } from "@vercel/blob";
import { HTTPException } from "hono/http-exception";
import sharp from "sharp";

import { LIMITS } from "@/config/constants";
import { parseSocialPostMedia } from "@/helpers/social-post-media";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { renderStudioPng } from "@/lib/image-studio/brand-overlay";
import { imageModel } from "@/lib/image-studio/catalog";
import { ensureImageCatalogFresh } from "@/lib/image-studio/fal-catalog-refresh";
import {
  DEFAULT_TALKING_VIDEO_VOICE,
  TALKING_VIDEO_PRESENTERS,
} from "@/lib/image-studio/talking-video";
import { DEFAULT_ANIMATE_MODEL_ID } from "@/lib/image-studio/video-model";
import { checkStyledPicture } from "@/lib/reference-library/style-check";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { listCmoBrandPictures } from "@/services/cmo-brand-media.service";
import { cmoBrandVisual } from "@/services/cmo-brand-visual.service";
import type { Cuso } from "@/services/cmo-cuso.service";
import { talkingVideoPresenter } from "@/services/cmo-presenter.service";
import {
  type CusoDrive,
  cusoDrive,
  saveCusoProjectFile,
} from "@/services/cuso-project-files.service";
import { readAssetBytes } from "@/services/image-studio-assets.service";
import {
  ensureStudioAssetDriveFile,
  writeOwnerDriveFile,
} from "@/services/image-studio-drive.service";
import {
  createImageJob,
  createTalkingVideoJob,
  createVideoJob,
  DEFAULT_SETTINGS,
} from "@/services/image-studio-jobs.service";
import {
  readReferenceImage,
  referenceLibraryAvailable,
} from "@/services/reference-library.service";
import {
  scheduleSocialPost,
  updateSocialPost,
} from "@/services/social-posts.service";
import { recordSokoBotCheckUsage } from "@/services/soko-bot-billing.service";

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
/**
 * The models a picture in a reference library style rotates through, one per
 * try: GPT Image 2.6 kept the period look and lettering best in Patrick's
 * NMKR test (2026-11-16), Nano Banana 2.1 made the boldest layouts, Seedream
 * 5 Pro the cleanest. A try that fails the style check goes to the next.
 */
export const REFERENCE_STYLE_MODELS = [
  "gpt-image-2-6",
  "nano-banana-2-1",
  "seedream-5-pro",
] as const;

/**
 * A styled picture the style check turned down keeps its finished job (it
 * was paid for) and says so in the job's error, which this starts.
 */
const REJECTED = "Style check: ";
/** A chat picture that passed keeps that on its job, so it is judged once. */
const PASSED = "Style passed";

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
  talking?: boolean;
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

/** Whether the piece is a video Core animates from a still. */
export function cmoPieceIsVideo(
  entry: Pick<CmoCalendarEntry, "channel" | "format">,
) {
  return Boolean(formatOf(entry)?.video);
}

/** Whether the piece is a talking video Core makes from its script. */
export function cmoPieceIsTalking(
  entry: Pick<CmoCalendarEntry, "channel" | "format">,
): boolean {
  return isCmoTalkingFormat(entry.channel, entry.format);
}

/** What Core makes a piece's media from: its visual, or a talking video's script. */
function hasBrief(
  piece: Pick<CmoMediaPiece, "channel" | "format" | "visual" | "script">,
): boolean {
  return Boolean(
    cmoPieceIsTalking(piece) ? piece.script?.trim() : piece.visual?.trim(),
  );
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
    | "styleReferenceId"
    | "headline"
    | "slides"
    | "script"
    | "presenter"
    | "voice"
    | "languageCode"
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
  step: "image" | "still" | "video" | "talking";
  visualKey: string;
  status: ProjectImageJobStatus;
  assetId: string | null;
  prompt: string;
  /** The style check turned the finished picture down: the next try starts. */
  rejected: boolean;
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
  piece: Pick<
    CmoMediaPiece,
    | "visual"
    | "visualFileIds"
    | "slides"
    | "styleReferenceId"
    | "headline"
    | "script"
    | "presenter"
    | "voice"
  >,
): string {
  // A talking video is made from its script and who speaks it.
  if (piece.script?.trim())
    return createHash("sha256")
      .update(
        `talking|${piece.script.trim()}|${piece.presenter ?? ""}|${piece.voice ?? ""}`,
      )
      .digest("hex")
      .slice(0, 10);
  // A style or headline joins the key only when set, so the keys of pieces
  // made before them do not change.
  const style = piece.styleReferenceId
    ? `|style:${piece.styleReferenceId}|${piece.headline ?? ""}`
    : "";
  return createHash("sha256")
    .update(
      `${piece.visual ?? ""}|${(piece.visualFileIds ?? []).join(",")}${piece.slides?.length ? `|${piece.slides.join("|")}` : ""}${style}`,
    )
    .digest("hex")
    .slice(0, 10);
}

/** A styled picture gets one try per style model; any other, two. */
function attemptsFor(piece: Pick<CmoMediaPiece, "styleReferenceId">): number {
  return piece.styleReferenceId ? REFERENCE_STYLE_MODELS.length : ATTEMPTS;
}

/** Whether Core makes this piece's picture in a reference library style. */
function styled(
  piece: Pick<CmoMediaPiece, "styleReferenceId">,
): piece is CmoMediaPiece & { styleReferenceId: string } {
  return Boolean(piece.styleReferenceId) && referenceLibraryAvailable();
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
    if (
      last?.status === ProjectImageJobStatus.SUCCEEDED &&
      last.assetId &&
      !last.rejected
    )
      return { kind: "attach", job: last };
    if (tried.length >= attemptsFor(piece)) return { kind: "failed" };
    return {
      kind: "start",
      step: name,
      attempt: tried.length + 1,
      sourceAssetId,
    };
  };
  if (cmoPieceIsTalking(piece)) return next("talking", null);
  if (!cmoPieceIsVideo(piece)) return next("image", null);
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
  if (!hasBrief(piece)) return "no_visual";
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
      error: true,
      asset: { select: { id: true } },
    },
  });
  return rows.flatMap((row) => {
    const [, , pieceId, slot, step, visualKey] = row.idempotencyKey.split(":");
    if (
      !pieceId ||
      !visualKey ||
      (step !== "image" &&
        step !== "still" &&
        step !== "video" &&
        step !== "talking")
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
        rejected: row.error?.startsWith(REJECTED) ?? false,
      },
    ];
  });
}

/** The aspect ratio a network shows this piece at. */
function aspectRatio(piece: CmoMediaPiece): string {
  if (cmoPieceIsVideo(piece) || /story|reel|short/.test(piece.format))
    return "9:16";
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
    cmoPieceIsVideo(piece)
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

/**
 * A picture in the look of an old print from the reference library: the
 * reference (the first image fal gets) lends only its style, the brand gives
 * the colours and, through the studio's brand block, its DESIGN.md. Core
 * places the real logo afterwards, so the model leaves its corner plain.
 */
export function cmoStylePrompt(input: {
  piece: Pick<CmoMediaPiece, "visual" | "title" | "headline" | "slides">;
  slot: number;
  businessName: string;
  colours: readonly string[];
}): string {
  const { piece } = input;
  const slide = piece.slides?.[input.slot]?.trim();
  const headline = piece.headline?.trim();
  return [
    "The first image is an old print, used ONLY as a style reference: borrow its illustration technique, layout, lettering and print texture.",
    "Copy none of its words, names, mastheads, characters or illustrations; make an entirely new picture.",
    `Make an original ad for ${input.businessName}. Scene: ${piece.visual?.trim() ?? piece.title}.${slide ? ` This slide: ${slide}.` : ""}`,
    headline
      ? `The only words in the picture: "${headline}", lettered in the reference's style and spelled exactly.`
      : "No words, letters or numbers in the picture.",
    input.colours.length > 0
      ? `Recolour everything around the brand colours ${input.colours.join(", ")}; a few neutral tones are fine.`
      : "",
    "Draw no logo, brand mark, emblem, coin, currency symbol, signature or watermark. Keep the lower-right corner plain: the brand's logo is placed there afterwards.",
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

/** The brand a styled picture is made and finished with. */
interface StyleBrand {
  colours: string[];
  /** The Project's logo, placed on every styled picture. */
  logo: Uint8Array | null;
}

/** The brand's colours (DESIGN.md) and logo bytes, read once per run. */
export async function loadStyleBrand(projectId: string): Promise<StyleBrand> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { logo: true, designMdUrl: true },
  });
  const visual = project ? await cmoBrandVisual(project, []) : null;
  let logo: Uint8Array | null = null;
  if (project?.logo) {
    const response = await fetch(project.logo, {
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (response?.ok) logo = new Uint8Array(await response.arrayBuffer());
  }
  return { colours: visual?.colors ?? [], logo };
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
      hasBrief(piece) &&
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
  let styleBrand: StyleBrand | null = null;
  const brandFor = async () => (styleBrand ??= await loadStyleBrand(projectId));
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
        if (inOrder)
          inOrder = await attach(
            context,
            drive,
            piece,
            action.job,
            styled(piece) &&
              action.job.step !== "video" &&
              action.job.step !== "talking"
              ? await brandFor()
              : null,
          );
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
          action.step === "video" || action.step === "talking"
            ? []
            : references(piece, brandPictures),
        colours:
          styled(piece) && action.step !== "video" && action.step !== "talking"
            ? (await brandFor()).colours
            : [],
      });
      // A refusal (credits, the hourly limit) stops starting, never
      // attaching: finished pictures further down still go on their posts.
      capacity = started ? capacity - 1 : 0;
    }
  }
}

/**
 * Who speaks a talking video. The owner's photo needs their recorded
 * consent; without it, or with a presenter or voice no catalog has, a stock
 * presenter and voice speak instead, so the month is not held up.
 */
async function talkingVoiceAndPresenter(
  context: MediaContext,
  drive: { workspaceId: string; userId: string },
  piece: CmoMediaPiece,
) {
  const voice = (SOKO_BOT_VOICEOVER_VOICES as readonly string[]).includes(
    piece.voice ?? "",
  )
    ? (piece.voice as (typeof SOKO_BOT_VOICEOVER_VOICES)[number])
    : DEFAULT_TALKING_VIDEO_VOICE;
  // Without a consented photo, "owner" falls back to the first stock presenter.
  const presenter = (await talkingVideoPresenter({
    projectId: context.cuso.projectId,
    userId: drive.userId,
    presenter: piece.presenter ?? "",
  })) ?? { kind: "stock" as const, id: TALKING_VIDEO_PRESENTERS[0]!.id };
  return { voice, presenter };
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
    /** The brand's colours, for a picture in a reference library style. */
    colours: string[];
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
    if (action.step === "talking") {
      await createTalkingVideoJob({
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        idempotencyKey,
        script: piece.script?.trim() ?? "",
        ...(await talkingVoiceAndPresenter(context, drive, piece)),
        languageCode: piece.languageCode ?? "en",
      });
      return true;
    }
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
    // A styled picture's try picks its model: the next one after a refusal.
    const style = styled(piece) ? piece.styleReferenceId : null;
    const model = imageModel(
      style
        ? REFERENCE_STYLE_MODELS[
            (action.attempt - 1) % REFERENCE_STYLE_MODELS.length
          ]
        : undefined,
    );
    await createImageJob({
      ...scope,
      prompt: style
        ? cmoStylePrompt({
            piece,
            slot,
            businessName: context.cuso.businessName,
            colours: input.colours,
          })
        : cmoImagePrompt({
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
      referenceFileIds: style ? [] : input.references,
      referenceLibraryIds: style ? [style] : [],
      parentAssetId: null,
    });
    return true;
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error;
    // The refusal can name the prompt, so only its status and name.
    recordCoreWarning(
      {
        operation: "cmo_media",
        sokoBot: { id: context.cuso.sokoBotId },
      },
      {
        message: "The image studio refused to start a CMO picture",
        why: "Image studio refused the generation",
        fix: "The piece waits for its picture; the next production sync asks again. If it repeats, check the status on its cmoPieces entry (429 is the hourly limit, 402 the balance).",
      },
      // One entry per piece: a month can refuse several on one event.
      { cmoPieces: [{ id: piece.id, failure: messageSafeErrorFields(error) }] },
    );
    return false;
  }
}

/**
 * Puts a finished picture or video on its piece, then schedules a complete
 * post. True once the file is on the piece.
 */
async function attach(
  context: MediaContext,
  drive: CusoDrive,
  piece: CmoMediaPiece,
  job: CmoMediaJob,
  /** Set for a styled picture: it is checked, then gets the brand's logo. */
  style: StyleBrand | null,
): Promise<boolean> {
  if (!job.assetId) return false;
  const finished = style
    ? await checkAndBrand(context, piece, job, style)
    : null;
  if (finished === "rejected") return false;
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
  // The logo goes onto the Drive file itself, from the untouched studio
  // picture, so finishing it again writes the same bytes.
  if (finished && "bytes" in finished) {
    const saved = await saveCusoProjectFile(
      drive,
      { pathname: file.pathname, filename: file.name },
      finished.bytes,
      finished.contentType,
    );
    if (!saved) return false;
  }
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

/**
 * Checks a styled picture next to its reference (headline, nothing copied,
 * brand colours, no stray marks, room for the logo) and places the brand's
 * logo on one that passes. A refusal marks the job, so the next model tries.
 */
async function checkAndBrand(
  context: { cuso: Pick<Cuso, "sokoBotId"> },
  piece: Pick<CmoMediaPiece, "styleReferenceId" | "headline">,
  job: Pick<CmoMediaJob, "id" | "assetId">,
  style: StyleBrand,
): Promise<"rejected" | { bytes: Buffer; contentType: string }> {
  const asset = await prisma.projectImageAsset.findUnique({
    where: { id: job.assetId ?? "" },
    select: { blobPathname: true, contentType: true },
  });
  const reference = piece.styleReferenceId
    ? await readReferenceImage(piece.styleReferenceId)
    : null;
  if (!asset || !reference) return "rejected";
  const picture = await readAssetBytes(asset.blobPathname);
  const check = await checkStyledPicture({
    picture,
    reference: reference.bytes,
    headline: piece.headline ?? null,
    colours: style.colours,
  });
  await recordSokoBotCheckUsage({
    sokoBotId: context.cuso.sokoBotId,
    key: `cmo-style-check:${job.id}`,
    costUsd: check.costUsd,
  });
  if (!check.passes) {
    await prisma.projectImageJob.update({
      where: { id: job.id },
      data: {
        error: `${REJECTED}${check.verdict.problems.join("; ").slice(0, 400) || "did not pass"}`,
      },
      select: { id: true },
    });
    return "rejected";
  }
  if (!style.logo) {
    return { bytes: Buffer.from(picture), contentType: asset.contentType };
  }
  const png = await renderStudioPng(picture, {
    logo: { bytes: style.logo, position: "bottom-right" },
  });
  return asset.contentType === "image/png"
    ? { bytes: png, contentType: "image/png" }
    : {
        bytes: await sharp(png).jpeg({ quality: 90 }).toBuffer(),
        contentType: "image/jpeg",
      };
}

/**
 * A styled picture Cuso started in chat (generate_image with a
 * styleReferenceId), once its job has finished: the same check and logo as a
 * month's picture, with the finished file in Files. A picture the check
 * turned down says why, so the next model can try. Judged once: asking
 * again returns the same answer.
 */
export async function finishCmoChatPicture(input: {
  cuso: Pick<Cuso, "sokoBotId" | "projectId">;
  drive: { workspaceId: string; organizationId: string | null; userId: string };
  job: { id: string; assetId: string; prompt: string; error: string | null };
  styleReferenceId: string;
  headline: string | null;
}): Promise<
  | { passed: true; file: { id: string; name: string } }
  | { passed: false; problems: string }
> {
  const { job, drive } = input;
  if (job.error?.startsWith(REJECTED))
    return { passed: false, problems: job.error.slice(REJECTED.length) };
  const finished =
    job.error === PASSED
      ? null
      : await checkAndBrand(
          input,
          {
            styleReferenceId: input.styleReferenceId,
            headline: input.headline ?? undefined,
          },
          job,
          await loadStyleBrand(input.cuso.projectId),
        );
  if (finished === "rejected") {
    const row = await prisma.projectImageJob.findUnique({
      where: { id: job.id },
      select: { error: true },
    });
    return {
      passed: false,
      problems: row?.error?.startsWith(REJECTED)
        ? row.error.slice(REJECTED.length)
        : "the picture or its reference could not be read",
    };
  }
  const file = await ensureStudioAssetDriveFile({
    projectId: input.cuso.projectId,
    assetId: job.assetId,
    ...drive,
    prompt: job.prompt,
    jobId: job.id,
  });
  if (!file) return { passed: false, problems: "its file could not be saved" };
  if (finished) {
    // The logo goes onto the Files copy; the pass is kept only once it is there.
    const saved = await writeOwnerDriveFile({
      ...drive,
      pathname: file.pathname,
      name: file.name,
      bytes: finished.bytes,
      contentType: finished.contentType,
    });
    if (!saved)
      return { passed: false, problems: "its file could not be saved" };
    await prisma.projectImageJob.update({
      where: { id: job.id },
      data: { error: PASSED },
      select: { id: true },
    });
  }
  return { passed: true, file: { id: file.id, name: file.name } };
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
    // A post's refusal can quote its text, so only its status and name.
    recordCoreWarning(
      { operation: "cmo_media" },
      {
        message: "Could not schedule a CMO Social post",
        why: "Social publishing refused the schedule",
        fix: "The post stays a draft; the next production sync tries again. If it repeats, check the status on its socialPosts entry.",
      },
      // One entry per post: a month can refuse several on one event.
      {
        socialPosts: [{ id: post.id, failure: messageSafeErrorFields(error) }],
      },
    );
  });
}

/** A Core media job settled: the month it belongs to moves on. */
export function isCmoMediaJob(idempotencyKey: string): boolean {
  return idempotencyKey.startsWith(`${KEY_PREFIX}:`);
}
