import { createHash } from "node:crypto";

import { ProjectImageJobStatus } from "@sokosumi/database";
import {
  CMO_PICKED_PRODUCTION_SKILL,
  CMO_SCENE_PRODUCTION_SKILL,
  CMO_V20_STRATEGY_SKILL,
  CMO_V21_STRATEGY_SKILL,
  CMO_V22_STRATEGY_SKILL,
  CMO_VARIED_PRODUCTION_SKILL,
  type CmoCalendarEntry,
  getSokoBotVersion,
  PICTURE_KINDS,
  type PictureKind,
  REFERENCE_KINDS,
  SOKO_BOT_VOICEOVER_VOICES,
} from "@sokosumi/soko-bot";
import {
  CMO_CHANNELS,
  cmoVideoShape,
  isCmoOwnerConfirmedChannel,
  isCmoShapedVideoFormat,
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
  placeScreen,
  SCREEN_PANEL_WORDS,
} from "@/lib/image-studio/screen-composite";
import {
  DEFAULT_TALKING_VIDEO_VOICE,
  TALKING_VIDEO_PRESENTERS,
} from "@/lib/image-studio/talking-video";
import { DEFAULT_ANIMATE_MODEL_ID } from "@/lib/image-studio/video-model";
import {
  layoutBlockMap,
  pickBestPicture,
} from "@/lib/reference-library/layout";
import { checkStyledPicture } from "@/lib/reference-library/style-check";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import type { StudioLogoPosition } from "@/schemas/project-image-studio.schema";
import {
  type CmoBrandPicture,
  listCmoBrandPictures,
  readCmoBrandLogo,
} from "@/services/cmo-brand-media.service";
import { cmoBrandVisual } from "@/services/cmo-brand-visual.service";
import type { Cuso } from "@/services/cmo-cuso.service";
import {
  cmoPictureStyle,
  referenceComposition,
} from "@/services/cmo-picture-style.service";
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
  CMO_MONTH_JOB_KEY_PREFIX,
  createImageJob,
  createShortVideoJob,
  createTalkingVideoJob,
  createVideoJob,
  DEFAULT_SETTINGS,
  downloadStudioFileReference,
  NOT_A_VIDEO_SHAPE_JOB,
  requestVideoShape,
  videoShapeJobKey,
} from "@/services/image-studio-jobs.service";
import {
  type ReferenceKind,
  readReferenceImage,
  readStyleTraits,
  referenceLibraryAvailable,
  type StyleTraits,
} from "@/services/reference-library.service";
import {
  scheduleSocialPost,
  updateSocialPost,
} from "@/services/social-posts.service";
import { recordSokoBotCheckUsage } from "@/services/soko-bot-billing.service";

/**
 * Core makes the month's pictures and videos. Cuso writes each piece's
 * visual (what it shows, and the brand pictures it is made from); Core
 * starts every picture once, six at a time, its own limit beside the studio's three,
 * puts it on its post and schedules the post on a connected network. Runs
 * that made their own media bought 25 files for 14 pieces and put one
 * picture on three posts. Each job's key names its piece, slot and visual,
 * so two callers racing start the same job, and a new visual starts over.
 */

const KEY_PREFIX = CMO_MONTH_JOB_KEY_PREFIX;
/** Tries a slot gets for one visual before the piece goes back to Cuso. */
const ATTEMPTS = 2;
/** Default references when the visual names none: the brand's own pictures. */
const DEFAULT_REFERENCES = 2;
/** A short shows its scene and at most this many of the brand's own pictures. */
const SHORT_BRAND_PICTURES = 3;
/**
 * The models a picture in a reference library style goes through, one per
 * try. Muse Image first, twice: on ten pieces of CMO.XYZ's month (2026-11-19)
 * it passed the style check 16 of 20 times at 1 credit, with every headline
 * spelled right. GPT Image 2.6 passed 9 of 10 and letters bolder, at 21
 * credits, so it is the remake. Nano Banana 2.1 is the last try.
 */
export const REFERENCE_STYLE_MODELS = [
  "muse-image",
  "muse-image",
  "gpt-image-2-6",
  "nano-banana-2-1",
] as const;

/**
 * The alternatives a cmo-v11 picture starts at once, one per entry: three on
 * Muse Image, two on MAI-Image 2.7 (2026-11-21 model test on the layout
 * prompt: Muse 19 of 24 passed at $0.026 a passed picture, MAI 10 of 16 with
 * the richest scenes). MAI needs both sides at 768 px or more, so a wide or
 * tall frame takes Muse in its place. The check model picks the best that
 * passed; GPT Image 2.6 remakes only when none did.
 */
export const PICK_MODELS = [
  "muse-image",
  "muse-image",
  "muse-image",
  "mai-image-2-7",
  "mai-image-2-7",
] as const;
export const PICK_REMAKE_MODELS = ["gpt-image-2-6"] as const;
/** Frames MAI-Image 2.7 can make at 1K. */
const MAI_FRAMES = new Set(["1:1", "4:5", "3:4", "4:3", "5:4"]);

/** The model of a picker alternative or remake, by its attempt label. */
export function cmoPickModel(attempt: string, aspectRatio: string): string {
  const index = Number(attempt.slice(1)) - 1;
  if (attempt.startsWith("r"))
    return PICK_REMAKE_MODELS[index] ?? PICK_REMAKE_MODELS[0];
  const model = PICK_MODELS[index] ?? "muse-image";
  return model === "mai-image-2-7" && !MAI_FRAMES.has(aspectRatio)
    ? "muse-image"
    : model;
}

/** Whether a Cuso version picks each picture from several alternatives (cmo-v11). */
export function cmoPicksPictures(
  versionId: string | null | undefined,
): boolean {
  return getSokoBotVersion(versionId).skills.includes(
    CMO_PICKED_PRODUCTION_SKILL,
  );
}

/**
 * A styled picture the style check turned down keeps its finished job (it
 * was paid for) and says so in the job's error, which this starts.
 */
export const CMO_STYLE_REJECTED = "Style check: ";
/**
 * A picture that passed keeps that on its job, so it is judged once, with
 * where its logo goes: ": logo drawn" when the model drew it in, else the
 * plain corner Core places it on. Plain "Style passed" (before 2026-11-21)
 * is the lower-right corner.
 */
export const CMO_STYLE_PASSED = "Style passed";

const LOGO_DRAWN = "logo drawn";

/** Whether a job's stored verdict is a pass. */
export function cmoStylePassed(error: string | null | undefined): boolean {
  return error?.startsWith(CMO_STYLE_PASSED) ?? false;
}

/** The stored pass, naming where the logo goes. */
export function cmoStylePassVerdict(
  logo: StudioLogoPosition | "drawn",
): string {
  return `${CMO_STYLE_PASSED}: ${logo === "drawn" ? LOGO_DRAWN : `logo ${logo}`}`;
}

/** Where a passed picture's logo goes: drawn in, or the corner Core places it on. */
export function cmoPassedLogo(error: string): StudioLogoPosition | "drawn" {
  const placed = error.slice(CMO_STYLE_PASSED.length).replace(/^: /, "");
  if (placed === LOGO_DRAWN) return "drawn";
  const corner = placed.replace(/^logo /, "");
  return (STUDIO_LOGO_CORNERS as readonly string[]).includes(corner)
    ? (corner as StudioLogoPosition)
    : "bottom-right";
}

const STUDIO_LOGO_CORNERS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
] as const;

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

/**
 * Whether the piece is a talking video Core makes from its script. A copy
 * in another shape (cmo-video-shapes) is its source's kind, which Core
 * wrote on it (`videoOfTalking`).
 */
export function cmoPieceIsTalking(
  entry: Pick<CmoCalendarEntry, "channel" | "format" | "videoOfTalking">,
): boolean {
  return (
    isCmoTalkingFormat(entry.channel, entry.format) ||
    (isCmoShapedVideoFormat(entry.channel, entry.format) &&
      entry.videoOfTalking === true)
  );
}

/** Whether Core makes the piece's picture, or each slide, in a library style. */
export function cmoPieceTakesStyle(
  entry: Pick<CmoCalendarEntry, "channel" | "format">,
): boolean {
  return (
    cmoPieceNeedsMedia(entry) &&
    !cmoPieceIsVideo(entry) &&
    !cmoPieceIsTalking(entry)
  );
}

type StyledEntry = Pick<
  CmoCalendarEntry,
  | "id"
  | "channel"
  | "format"
  | "title"
  | "visual"
  | "styleReferenceId"
  | "slides"
  | "slideHeadlines"
> &
  Partial<Pick<CmoCalendarEntry, "date" | "time">>;

type OtherStyledEntry = Pick<StyledEntry, "id" | "styleReferenceId"> &
  Partial<Pick<StyledEntry, "channel" | "date" | "time">>;

/**
 * Whether a Cuso version makes a varied month (cmo-v8): pictures in varied
 * kinds of print, and LinkedIn openings Core reads before a save.
 */
export function cmoMakesVariedMonth(
  versionId: string | null | undefined,
): boolean {
  const { skills } = getSokoBotVersion(versionId);
  return (
    skills.includes(CMO_VARIED_PRODUCTION_SKILL) ||
    skills.includes(CMO_SCENE_PRODUCTION_SKILL) ||
    skills.includes(CMO_PICKED_PRODUCTION_SKILL)
  );
}

/**
 * Whether a Cuso version writes its short videos as shorts (cmo-v20): a
 * script, a hook line and a kind, cut by Core from the brand's pictures and
 * site instead of one picture animated.
 */
export function cmoWritesShorts(versionId: string | null | undefined): boolean {
  const { skills } = getSokoBotVersion(versionId);
  return (
    skills.includes(CMO_V20_STRATEGY_SKILL) ||
    skills.includes(CMO_V21_STRATEGY_SKILL) ||
    skills.includes(CMO_V22_STRATEGY_SKILL)
  );
}

/** Whether a Cuso version writes a styled picture's visual as a scene alone (cmo-v9). */
export function cmoWritesSceneVisuals(
  versionId: string | null | undefined,
): boolean {
  const { skills } = getSokoBotVersion(versionId);
  return (
    skills.includes(CMO_SCENE_PRODUCTION_SKILL) ||
    skills.includes(CMO_PICKED_PRODUCTION_SKILL)
  );
}

/**
 * Words that give a styled picture its own look. NMKR's visuals (2026-11-20)
 * named "cream paper, dark ink, one green accent" (31 of 40) and "no extra
 * text" (39 of 40), and the look overrode the print's every time.
 */
const LOOK_WORDS: readonly RegExp[] = [
  /#[0-9a-f]{3,6}\b/i,
  /\b(?:styled?|look of|in the manner of|rendered|render it)\b/i,
  /\b(?:lithograph\w*|woodcut|woodblock|wood engraving|engraving|etching|screen ?print\w*|silkscreen|letterpress|gouache|watercolou?r|halftone|risograph)\b/i,
  /\b(?:illustrat\w+|vintage|retro|art deco|bauhaus|modernist|swiss|isotype|pictograms?|icons?|diagrams?|infographic\w*|editorial|flat graphic|minimalist)\b/i,
  /\b(?:palette|accent|colou?r scheme|brand colou?rs?|monochrome|sepia|duotone|linework|line work|muted|neutral tones?|warm tones?|texture)\b/i,
  /\b(?:cream|light|aged|off-white|textured|kraft|old|white) (?:paper|canvas|ground|background)\b/i,
  /\b(?:dark|black|green|one|two|single|bright) inks?\b/i,
  /\b(?:\d{4}s|\d{1,2}(?:st|nd|rd|th)[- ]century|mid-century)\b/i,
  /\b(?:no|avoid|without any|do not|don't|never)\b(?:\s+\w+){0,3}\s+(?:text|words?|labels?|prices?|logos?|lettering|captions?|interface|numbers?|screens?)\b/i,
  /\bavoid\b/i,
];

/** The look words a styled visual names, as written. */
export function cmoVisualLookWords(visual: string): string[] {
  return LOOK_WORDS.flatMap((pattern) => visual.match(pattern)?.[0] ?? []);
}

/**
 * Why styled visuals cannot be saved by a cmo-v9 Cuso, or null: a styled
 * picture's look comes from its print, so its visual is the scene alone.
 */
export function cmoSceneVisualProblem(
  saved: readonly StyledEntry[],
): string | null {
  // Where the library is set up every picture takes a style, so a visual
  // sent without its reference is a styled one too.
  const named = saved.flatMap((entry) => {
    const words =
      cmoPieceTakesStyle(entry) && entry.visual
        ? cmoVisualLookWords(entry.visual)
        : [];
    return words.length > 0 ? [`${entry.id} (${words.join(", ")})`] : [];
  });
  if (named.length === 0) return null;
  return `Nothing was saved: a styled picture takes its look from its print, and these visuals name a look of their own: ${named.join("; ")}. Write each visual as one concrete scene: who or what, doing what, where, often a physical metaphor for the piece's point. Describe the scene only: no medium, era, colours, paper or "no …" list. Then save again.`;
}

/**
 * Infographics a month of `styled` pictures may hold: one in four. NMKR's
 * how-to month (2026-11-20) took 56 of 69 and read as one panel diagram
 * after another.
 */
export function cmoInfographicCap(styled: number): number {
  return Math.max(1, Math.floor(styled / 4));
}

/** The kinds of print a month's pictures may vary over (cmo-v8). */
export interface CmoPictureKinds {
  /** Each reference's kind, by its id. */
  kindOf: ReadonlyMap<string, string>;
  /** The styled pictures the month plans. */
  planned: number;
}

const byTime = (left: OtherStyledEntry, right: OtherStyledEntry) =>
  `${left.date ?? ""}${left.time ?? ""}`.localeCompare(
    `${right.date ?? ""}${right.time ?? ""}`,
  );

/**
 * The month's kind rules for a save: at most one infographic in four, and
 * no two neighbouring pieces on a network in one kind. Only what the save
 * brings is refused; a month that already broke a rule keeps what it has.
 */
function pictureKindProblem(
  saved: readonly OtherStyledEntry[],
  others: readonly OtherStyledEntry[],
  kinds: CmoPictureKinds,
): string | null {
  const savedIds = new Set(saved.map((entry) => entry.id));
  const month = new Map<string, OtherStyledEntry & { kind: string }>();
  for (const entry of [...others, ...saved]) {
    const kind = entry.styleReferenceId
      ? kinds.kindOf.get(entry.styleReferenceId)
      : undefined;
    if (kind) month.set(entry.id, { ...entry, kind });
    else month.delete(entry.id);
  }
  const infographics = [...month.values()].filter(
    (entry) => entry.kind === "infographic",
  );
  const cap = cmoInfographicCap(kinds.planned);
  const added = infographics.filter((entry) => savedIds.has(entry.id));
  if (infographics.length > cap && added.length > 0)
    return `Nothing was saved: ${added.map((entry) => entry.id).join(", ")} would make ${infographics.length} infographics in a month of ${kinds.planned} pictures. At most ${cap} (one in four), and only on a picture that shows numbers or a comparison: give ${added.length === 1 ? "it" : "them"} another kind of print (find_style_references with the piece's real purpose) and save again.`;
  const byChannel = new Map<string, (OtherStyledEntry & { kind: string })[]>();
  for (const entry of month.values())
    if (entry.channel && entry.date)
      byChannel.set(entry.channel, [
        ...(byChannel.get(entry.channel) ?? []),
        entry,
      ]);
  for (const [channel, entries] of byChannel) {
    const ordered = entries.sort(byTime);
    for (let index = 1; index < ordered.length; index++) {
      const before = ordered[index - 1]!;
      const after = ordered[index]!;
      if (
        before.kind === after.kind &&
        (savedIds.has(before.id) || savedIds.has(after.id))
      )
        return `Nothing was saved: ${before.id} and ${after.id} follow each other on ${channel} in one kind of print (${after.kind}). Give one of them another kind (find_style_references with kinds left out of ${after.kind}) and save again.`;
    }
  }
  return null;
}

/** A styled piece of the month with its print's kind. */
export interface CmoKindedPiece {
  id: string;
  channel: string;
  date?: string;
  time?: string;
  kind: string;
}

/**
 * The kinds a piece's print may take so the month keeps the kind rules: not
 * its neighbours' on its network, and an infographic only for numbers or a
 * comparison while the month is under its cap.
 */
export function cmoAllowedKinds(input: {
  piece: Omit<CmoKindedPiece, "kind">;
  month: readonly CmoKindedPiece[];
  infographicSuits: boolean;
  planned: number;
}): ReferenceKind[] {
  const { piece } = input;
  const others = input.month.filter((entry) => entry.id !== piece.id);
  const lane = [
    ...others.filter((entry) => entry.channel === piece.channel),
    piece,
  ].sort(byTime);
  const at = lane.indexOf(piece);
  const neighbours = new Set(
    [lane[at - 1], lane[at + 1]].flatMap((entry) =>
      entry && "kind" in entry ? [entry.kind] : [],
    ),
  );
  const infographics = others.filter(
    (entry) => entry.kind === "infographic",
  ).length;
  const infographicFits =
    input.infographicSuits && infographics < cmoInfographicCap(input.planned);
  return REFERENCE_KINDS.filter(
    (kind) =>
      !neighbours.has(kind) && (kind !== "infographic" || infographicFits),
  );
}

/**
 * Why a save of pictures cannot be kept, or null: every picture takes a
 * library style, a carousel has its words per slide, and no reference is
 * used on two pieces of a month. With `kinds` (cmo-v8), the month's kinds
 * vary too. `saved` are the pieces being saved, as they will stand;
 * `others` every other piece of the month.
 */
export function cmoPictureStyleProblem(
  saved: readonly StyledEntry[],
  others: readonly OtherStyledEntry[],
  kinds?: CmoPictureKinds,
): string | null {
  const pictures = saved.filter(
    (entry) => cmoPieceTakesStyle(entry) && entry.visual?.trim(),
  );
  const plain = pictures.filter((entry) => !entry.styleReferenceId);
  if (plain.length > 0)
    return `Nothing was saved: ${plain.map((entry) => entry.id).join(", ")} ${plain.length === 1 ? "has a picture and no style" : "have a picture and no style"}. Every picture takes the look of an old print: call find_style_references for each and save again with its styleReferenceId (and headline, or slideHeadlines for a carousel).`;
  const wordless = pictures.find((entry) => {
    const slides = cmoPieceSlides(entry);
    return slides > 0 && (entry.slideHeadlines?.length ?? 0) < slides;
  });
  if (wordless)
    return `Nothing was saved: the carousel ${wordless.id} needs slideHeadlines, one entry per slide (${cmoPieceSlides(wordless)}), each the few words lettered on that slide.`;
  const owner = new Map<string, string>();
  for (const entry of [...others, ...pictures]) {
    if (!entry.styleReferenceId) continue;
    const first = owner.get(entry.styleReferenceId);
    if (first && first !== entry.id)
      return `Nothing was saved: ${entry.id} and ${first} use the same style reference. Each piece takes its own: pick another result of find_style_references for one of them and save again.`;
    owner.set(entry.styleReferenceId, entry.id);
  }
  return kinds ? pictureKindProblem(pictures, others, kinds) : null;
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
    | "pictureKind"
    | "headline"
    | "slides"
    | "slideHeadlines"
    | "script"
    | "presenter"
    | "voice"
    | "shortFormat"
    | "hookLine"
    | "languageCode"
    | "socialPostId"
    | "videoOf"
  > {
  /** What is on it already: a post's file pathnames, a file piece's file ids. */
  media: readonly string[];
}

/** One studio job Core started for a piece. */
export interface CmoMediaJob {
  id: string;
  pieceId: string;
  slot: number;
  step: "image" | "still" | "video" | "talking" | "short";
  visualKey: string;
  status: ProjectImageJobStatus;
  assetId: string | null;
  prompt: string;
  /** The style check turned the finished picture down: the next try starts. */
  rejected: boolean;
  /**
   * The try, from its key: "1", "2" … for one picture at a time; "p1" to "p5"
   * for a cmo-v11 picture's alternatives and "r1" for its remake.
   */
  attempt: string;
  createdAt: Date;
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
      attempt: number | string;
      sourceAssetId: string | null;
    }
  /** Every alternative of a cmo-v11 picture is in: check them and pick one. */
  | { kind: "pick"; jobs: CmoMediaJob[] };

/** A cmo-v11 picture's pick, as the slot action reads it. */
export interface CmoSlotPick {
  chosenJobId: string | null;
}

/** The visual and its pictures, as one short key: a new visual starts over. */
export function cmoVisualKey(
  piece: Pick<
    CmoMediaPiece,
    | "visual"
    | "visualFileIds"
    | "slides"
    | "styleReferenceId"
    | "headline"
    | "slideHeadlines"
    | "script"
    | "presenter"
    | "voice"
    | "shortFormat"
    | "hookLine"
  >,
): string {
  // A short is cut from its scene picture, its script, kind and hook line.
  if (piece.shortFormat)
    return createHash("sha256")
      .update(
        `short|${piece.shortFormat}|${piece.script?.trim() ?? ""}|${piece.hookLine ?? ""}|${piece.visual ?? ""}|${(piece.visualFileIds ?? []).join(",")}`,
      )
      .digest("hex")
      .slice(0, 10);
  // A talking video is made from its script and who speaks it.
  if (piece.script?.trim())
    return createHash("sha256")
      .update(
        `talking|${piece.script.trim()}|${piece.presenter ?? ""}|${piece.voice ?? ""}`,
      )
      .digest("hex")
      .slice(0, 10);
  // A style, headline or slide's words joins the key only when set, so the
  // keys of pieces made before them do not change.
  const style = piece.styleReferenceId
    ? `|style:${piece.styleReferenceId}|${piece.headline ?? ""}${piece.slideHeadlines?.length ? `|${piece.slideHeadlines.join("|")}` : ""}`
    : "";
  return createHash("sha256")
    .update(
      `${piece.visual ?? ""}|${(piece.visualFileIds ?? []).join(",")}${piece.slides?.length ? `|${piece.slides.join("|")}` : ""}${style}`,
    )
    .digest("hex")
    .slice(0, 10);
}

/** A styled picture gets one try per entry of the style models; any other, two. */
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
  options: {
    /** Start a new picture as five alternatives (a cmo-v11 Cuso). */
    picker?: boolean;
    /** The slot's pick, once made. */
    pick?: CmoSlotPick | null;
  } = {},
): CmoSlotAction {
  const picker =
    piece.styleReferenceId &&
    !cmoPieceIsVideo(piece) &&
    !cmoPieceIsTalking(piece) &&
    (options.picker || jobs.some((job) => /^[pr]\d/.test(job.attempt)));
  if (picker) return pickerAction(jobs, options.pick ?? null);
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
  // A video starts from a still of its scene, made from the brand's own
  // pictures: a cmo-v20 short is then cut from it and the site to its
  // script, an older video animates it. Each is retried on its own.
  const still = next("still", null);
  if (still.kind !== "attach") return still;
  return next(
    piece.shortFormat && piece.script?.trim() ? "short" : "video",
    still.job.assetId,
  );
}

/**
 * A cmo-v11 picture: five alternatives at once, a pick once all are in, a
 * remake only when none passed. A pick that chose a job attaches it.
 */
function pickerAction(
  all: readonly CmoMediaJob[],
  pick: CmoSlotPick | null,
): CmoSlotAction {
  const jobs = all.filter((job) => job.step === "image");
  const chosen = pick?.chosenJobId
    ? jobs.find((job) => job.id === pick.chosenJobId)
    : undefined;
  if (chosen?.assetId && chosen.status === ProjectImageJobStatus.SUCCEEDED)
    return { kind: "attach", job: chosen };
  const alternatives = jobs.filter((job) => job.attempt.startsWith("p"));
  if (alternatives.length < PICK_MODELS.length)
    return {
      kind: "start",
      step: "image",
      attempt: `p${alternatives.length + 1}`,
      sourceAssetId: null,
    };
  if (alternatives.some((job) => LIVE.has(job.status))) return { kind: "wait" };
  const remakes = jobs.filter((job) => job.attempt.startsWith("r"));
  // A remake starts only after a pick, so one stands for it where the pick
  // itself is not read (cmoMediaState).
  if (!pick && remakes.length === 0)
    return { kind: "pick", jobs: alternatives };
  const last = remakes.at(-1);
  if (!last)
    return { kind: "start", step: "image", attempt: "r1", sourceAssetId: null };
  if (LIVE.has(last.status)) return { kind: "wait" };
  if (
    last.status === ProjectImageJobStatus.SUCCEEDED &&
    last.assetId &&
    !last.rejected
  )
    return { kind: "attach", job: last };
  if (remakes.length < PICK_REMAKE_MODELS.length)
    return {
      kind: "start",
      step: "image",
      attempt: `r${remakes.length + 1}`,
      sourceAssetId: null,
    };
  return { kind: "failed" };
}

/** Where a piece's media stands, without changing anything. */
export function cmoMediaState(
  piece: CmoMediaPiece,
  jobs: readonly CmoMediaJob[],
): CmoMediaState {
  if (!cmoPieceNeedsMedia(piece) || piece.media.length >= slotsOf(piece))
    return "made";
  if (!hasBrief(piece)) return "no_visual";
  for (let slot = piece.media.length; slot < slotsOf(piece); slot += 1) {
    const action = cmoSlotAction(piece, slotJobs(piece, slot, jobs));
    if (action.kind === "failed") return "failed";
  }
  return "making";
}

/**
 * How many visuals a piece's picture failed on: every job of the visual
 * ended, and none made a picture that passed. A visual Cuso replaced while
 * its jobs still ran counts only once they ended.
 */
export function cmoFailedVisuals(
  piece: CmoMediaPiece,
  jobs: readonly CmoMediaJob[],
): number {
  const byVisual = new Map<string, CmoMediaJob[]>();
  for (const job of jobs) {
    if (job.pieceId !== mediaPieceId(piece) || job.step === "talking") continue;
    byVisual.set(job.visualKey, [...(byVisual.get(job.visualKey) ?? []), job]);
  }
  const current = cmoVisualKey(piece);
  let failed = 0;
  for (const [key, tried] of byVisual) {
    const ended = tried.every((job) => !LIVE.has(job.status));
    const passed = tried.some(
      (job) =>
        job.status === ProjectImageJobStatus.SUCCEEDED &&
        job.assetId &&
        !job.rejected,
    );
    if (key === current) {
      if (cmoMediaState(piece, jobs) === "failed") failed += 1;
    } else if (ended && !passed) failed += 1;
  }
  return failed;
}

/** The piece id in a talking video's job key: its posts share the one job. */
const SHARED_VIDEO = "video";

/**
 * The piece whose jobs make this piece's media: a short video's post on
 * another network (a Reel or a Short of a TikTok, `videoOf`) is the same
 * file, so it reads and starts its source's jobs.
 */
function mediaPieceId(piece: CmoMediaPiece): string {
  return piece.videoOf && cmoPieceIsVideo(piece) && !cmoPieceIsTalking(piece)
    ? piece.videoOf
    : piece.id;
}

function jobKey(
  versionId: string,
  piece: CmoMediaPiece,
  slot: number,
  step: CmoMediaJob["step"],
  attempt: number | string,
): string {
  return [
    KEY_PREFIX,
    versionId,
    step === "talking" ? SHARED_VIDEO : mediaPieceId(piece),
    slot,
    step,
    cmoVisualKey(piece),
    attempt,
  ].join(":");
}

/**
 * The jobs started for one slot of a piece under its current visual. A
 * talking video is one job for every piece that speaks the same script with
 * the same presenter and voice, so a Reel and a Short of it are made once; a
 * short video's copies read their source's jobs.
 */
function slotJobs(
  piece: CmoMediaPiece,
  slot: number,
  jobs: readonly CmoMediaJob[],
): CmoMediaJob[] {
  const key = cmoVisualKey(piece);
  return jobs.filter((job) =>
    cmoPieceIsTalking(piece)
      ? job.step === "talking" && job.visualKey === key
      : job.pieceId === mediaPieceId(piece) &&
        job.slot === slot &&
        job.visualKey === key,
  );
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
      createdAt: true,
      asset: { select: { id: true } },
    },
  });
  return rows.flatMap((row) => {
    const [, , pieceId, slot, step, visualKey, attempt] =
      row.idempotencyKey.split(":");
    if (
      !pieceId ||
      !visualKey ||
      (step !== "image" &&
        step !== "still" &&
        step !== "video" &&
        step !== "talking" &&
        step !== "short")
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
        rejected: row.error?.startsWith(CMO_STYLE_REJECTED) ?? false,
        attempt: attempt ?? "1",
        createdAt: row.createdAt,
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
    piece.shortFormat
      ? "A vertical photo of this one scene, with no screen, phone or laptop showing anything: it opens a short video that shows the brand's real website itself."
      : cmoPieceIsVideo(piece)
        ? "A vertical still with one clear subject and room to move: it becomes a five-second video."
        : "",
    input.references > 0
      ? piece.shortFormat
        ? `Made for ${input.businessName} from the reference pictures: keep the brand's products and colours exactly, and change the setting, the framing and the light.`
        : `Made for ${input.businessName} from the reference pictures: keep what they show of the brand (its product, its screens, its colours and logo) exactly, and change the setting, the framing and the light.`
      : `Made for ${input.businessName}.`,
    words,
    "Never a real, named person.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** The words lettered into a styled picture: a slide's own, else the headline. */
export function cmoStyleHeadline(
  piece: Pick<CmoMediaPiece, "headline" | "slideHeadlines">,
  slot: number,
): string | null {
  return piece.slideHeadlines?.[slot]?.trim() || piece.headline?.trim() || null;
}

/**
 * Cuso's visuals often ask for steps or panels, and an infographic reference
 * letters every one: in production (2026-11-19) 33 of 56 tries on
 * infographic references were turned down for words besides the headline.
 */
const STEPS_WITHOUT_WORDS =
  "Show any steps, stages or panels with pictures alone: no numbers, step labels, captions, sub-titles, or letters on signs, screens, maps, compasses, tokens or objects.";

/** Reference kinds whose prints carry a headline, a second line and an address. */
const LETTERED_KINDS = new Set([
  "poster",
  "magazine-cover",
  "book-cover",
  "record-cover",
  "playbill",
  "ad",
  "trade-card",
  "label",
]);

/** A colour's lightness, 0 to 1. */
function lightness(hex: string): number {
  const value = Number.parseInt(hex.replace("#", "").padEnd(6, "0"), 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255];
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
}

/** A colour's saturation, 0 to 1. */
function saturation(hex: string): number {
  const value = Number.parseInt(hex.replace("#", "").padEnd(6, "0"), 16);
  const [r, g, b] = [value >> 16, (value >> 8) & 255, value & 255];
  const max = Math.max(r, g, b);
  return max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
}

/**
 * Three inks by role, as the 16 Nov test printed them: the brand's colour as
 * the accent, its darkest as the ink, its lightest as the paper. Five
 * colours (NMKR's blue and grey-green too) gave cream with a little green.
 */
export function cmoStyleInks(colours: readonly string[]): {
  accent: string | null;
  ink: string | null;
  paper: string | null;
} {
  const ink = colours.find(
    (hex) =>
      lightness(hex) < 0.2 &&
      lightness(hex) === Math.min(...colours.map(lightness)),
  );
  const paper = colours.find(
    (hex) =>
      lightness(hex) > 0.85 &&
      lightness(hex) === Math.max(...colours.map(lightness)),
  );
  const accent =
    colours.find(
      (hex) => hex !== ink && hex !== paper && saturation(hex) > 0.35,
    ) ??
    colours.find((hex) => hex !== ink && hex !== paper) ??
    null;
  return { accent, ink: ink ?? null, paper: paper ?? null };
}

/**
 * The second line a lettered print carries: the piece's title, when it says
 * more than the headline does (a title that repeats it would print twice).
 */
export function cmoStyleSecondLine(
  piece: Pick<CmoMediaPiece, "title" | "headline">,
): string | null {
  const title = piece.title?.trim();
  const headline = piece.headline?.trim();
  if (!title || !headline || title.split(/\s+/).length > 8) return null;
  const words = (text: string) =>
    new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const [a, b] = [words(title), words(headline)];
  const shared = [...a].filter((word) => b.has(word)).length;
  return shared / new Set([...a, ...b]).size < 0.4 ? title : null;
}

/** Words a styled picture may letter besides its headline. */
export function cmoStyleLines(
  piece: Pick<CmoMediaPiece, "title" | "headline" | "slides">,
  businessName: string,
): string[] {
  const second = piece.slides?.length ? null : cmoStyleSecondLine(piece);
  return [...(second ? [second] : []), businessName];
}

/** "a 1930s poster": what the reference is, from its catalogue entry. */
function referenceName(traits: StyleTraits): string {
  const era = traits.era && traits.era !== "unknown" ? `${traits.era} ` : "";
  const kind =
    traits.kind === "other" ? "print" : traits.kind.replace("-", " ");
  return `${/^[aeiou]/i.test(era || kind) ? "an" : "a"} ${era}${kind}`;
}

/**
 * A picture in the look of an old print from the reference library, the way
 * the 16 Nov test that Patrick picked made them: image 1 is the reference,
 * named by its own catalogue traits; image 2 is the brand's logo, drawn into
 * the design; one concrete scene; three inks; a lettered print carries its
 * headline, a second line and the site's address. Without the logo image,
 * Core places the logo afterwards on a plain corner. A piece that shows the
 * brand's site gets that picture next, set into the style unchanged.
 */
export function cmoStylePrompt(input: {
  piece: Pick<
    CmoMediaPiece,
    "visual" | "title" | "headline" | "slides" | "slideHeadlines"
  >;
  slot: number;
  businessName: string;
  colours: readonly string[];
  /** The brand's own pictures sent after the reference (and the logo). */
  brandPictures?: number;
  /** Core places the brand's real screen on a plain panel afterwards. */
  screen?: boolean;
  /** The reference's catalogue entry. */
  traits?: StyleTraits | null;
  /** The brand's logo is the second image, to be drawn into the design. */
  logo?: boolean;
}): string {
  const { piece, traits } = input;
  const slides = piece.slides?.length ?? 0;
  const slide = piece.slides?.[input.slot]?.trim();
  const headline = cmoStyleHeadline(piece, input.slot);
  const own = input.brandPictures ?? 0;
  const firstOwn = input.logo ? 3 : 2;
  const lettered =
    slides === 0 && Boolean(traits && LETTERED_KINDS.has(traits.kind));
  const second = lettered ? cmoStyleSecondLine(piece) : null;
  const { accent, ink, paper } = cmoStyleInks(input.colours);
  const besides = [
    own > 0 ? "what stands in the brand's own picture" : "",
    input.logo ? "the logo" : "",
  ]
    .filter(Boolean)
    .join(" and ");
  const words = headline
    ? lettered
      ? `Letter "${headline}" large in the reference's lettering, spelled exactly${second ? `, the second line "${second}" smaller` : ""}, and "${input.businessName}" small at the foot. No other words${besides ? ` besides ${besides}` : ""}.`
      : `The only words in the picture${besides ? ` besides ${besides}` : ""}: "${headline}", lettered large in the reference's style and spelled exactly. ${STEPS_WITHOUT_WORDS}`
    : `No words, letters or numbers in the picture${besides ? ` besides ${besides}` : ""}.`;
  return [
    traits
      ? `Image 1 is ${referenceName(traits)}, used ONLY as a style reference. Copy its technique (${traits.technique})${traits.lettering && traits.lettering !== "none" ? ` and its lettering (${traits.lettering})` : ""}, and keep its paper and print texture. Compose a new picture around the scene below: none of its figures, objects or drawings.`
      : "The first image is an old print, used ONLY as a style reference: borrow its illustration technique, layout, lettering and print texture.",
    "Copy none of its words, names, mastheads, characters or drawings; make an entirely new picture.",
    input.logo
      ? `Image 2 is ${input.businessName}'s logo. Place it exactly as drawn, exactly once, as part of the design (in a masthead, a footer or a sign); never redraw, restyle or recolour it, and never repeat it on signs or objects in the scene.`
      : "",
    own > 0
      ? `${own > 1 ? `Images ${firstOwn} and on are` : `Image ${firstOwn} is`} ${input.businessName}'s own picture${own > 1 ? "s" : ""} of its site or product. Set what the scene shows of it into the composition as it is, like a plate printed into the page: its layout, words and colours unchanged and readable. Invent no price, number, plan, label or interface detail it does not show.`
      : "",
    `Make an original ad for ${input.businessName}. Scene: ${piece.visual?.trim() ?? piece.title}.${slides > 1 ? " One picture of a series: the others share this same style and colours. Draw no slide number, page number or counter." : ""}${slide ? ` This slide: ${slide}.` : ""}`,
    input.screen
      ? `Leave one plain, light, empty panel ${SCREEN_PANEL_WORDS}, with nothing drawn in it and no frame of your own: the brand's real screen is placed there afterwards. Draw no other screen, browser, phone, laptop, monitor or web page anywhere in the picture. Keep the headline in the top quarter, above the panel.`
      : "",
    words,
    "Signs, papers, screens and objects carry no words; no date, issue number, price, printer's credit, caption, signature or seal.",
    accent || ink || paper
      ? `Recolour it in the brand's inks instead of the reference's own colours: ${[accent && `${accent} as the accent`, ink && `${ink} as the ink`, paper && `on ${paper} paper`].filter(Boolean).join(", ")}.`
      : "",
    input.logo
      ? "Draw no other logo, brand mark, emblem, coin, currency symbol, signature or watermark."
      : "Draw no logo, brand mark, emblem, coin, currency symbol, signature or watermark. Keep one corner plain and every word clear of it: the brand's logo is placed there afterwards.",
    "Never a real, named person.",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Kinds of print whose layout a cmo-v11 picture borrows: they carry a clear
 * headline, subject and space. A trade card, label or plain illustration
 * gave the layout experiment little to follow.
 */
export const LAYOUT_KINDS: ReadonlySet<string> = new Set([
  "poster",
  "magazine-cover",
  "ad",
  "book-cover",
  "record-cover",
  "playbill",
  "infographic",
]);

/**
 * The picture kind a piece takes: the one asked for unless a neighbouring
 * piece on its network already has it; then the next kind that keeps the two
 * apart. With one look for the whole brand, the kind is what keeps a month
 * from being one flat illustration after another.
 */
export function cmoNeighbourlyKind(
  wanted: PictureKind | null | undefined,
  piece: Pick<CmoCalendarEntry, "id" | "channel" | "date" | "time">,
  calendar: readonly Pick<
    CmoCalendarEntry,
    "id" | "channel" | "date" | "time" | "pictureKind" | "status"
  >[],
  given: ReadonlyMap<string, PictureKind> = new Map(),
): PictureKind {
  const when = (entry: Pick<CmoCalendarEntry, "date" | "time">) =>
    `${entry.date} ${entry.time ?? ""}`;
  const neighbours = calendar
    .filter(
      (entry) =>
        entry.channel === piece.channel &&
        entry.id !== piece.id &&
        entry.status !== "skipped",
    )
    .map((entry) => ({
      at: when(entry),
      kind: given.get(entry.id) ?? entry.pictureKind,
    }))
    .filter((entry) => entry.kind)
    .sort((a, b) => a.at.localeCompare(b.at));
  const at = when(piece);
  const taken = new Set(
    [
      neighbours.filter((entry) => entry.at < at).at(-1)?.kind,
      neighbours.find((entry) => entry.at > at)?.kind,
    ].filter(Boolean),
  );
  const first = wanted ?? cmoPictureKind({ id: piece.id });
  const order = [first, ...PICTURE_KINDS.filter((kind) => kind !== first)];
  return order.find((kind) => !taken.has(kind)) ?? first;
}

/** A piece's picture kind: its own, else one chosen from its id so a month varies. */
export function cmoPictureKind(
  piece: Pick<CmoMediaPiece, "id" | "pictureKind">,
): PictureKind {
  if (piece.pictureKind) return piece.pictureKind;
  const sum = [...piece.id].reduce(
    (total, char) => total + char.charCodeAt(0),
    0,
  );
  return PICTURE_KINDS[sum % PICTURE_KINDS.length] ?? PICTURE_KINDS[0];
}

/**
 * A cmo-v11 picture: the reference lends only its layout, sent as a block map
 * (image 1), and the picture is drawn in the brand's own look and the piece's
 * picture kind (owner, 2026-11-21: "take the layout and adapt the style").
 * Naming the text slots stopped the model inventing taglines in the layout's
 * smaller lines (7 → 12 of 16 passed in the layout experiment).
 */
export function cmoLayoutPrompt(input: {
  piece: Pick<
    CmoMediaPiece,
    | "id"
    | "visual"
    | "title"
    | "headline"
    | "slides"
    | "slideHeadlines"
    | "pictureKind"
  >;
  slot: number;
  businessName: string;
  /** The reference's composition in words. */
  composition: string | null;
  /** How the brand's pictures look, from its DESIGN.md. */
  pictureStyle: string;
  logo?: boolean;
  /** The brand's own pictures sent after the block map (and the logo). */
  brandPictures?: number;
  screen?: boolean;
}): string {
  const { piece } = input;
  const slides = piece.slides?.length ?? 0;
  const slide = piece.slides?.[input.slot]?.trim();
  const headline = cmoStyleHeadline(piece, input.slot);
  const second = slides === 0 ? cmoStyleSecondLine(piece) : null;
  const own = input.brandPictures ?? 0;
  const firstOwn = input.logo ? 3 : 2;
  const slots = headline
    ? `Its text slots take only these words: "${headline}" in the largest slot, spelled exactly${second ? `, "${second}" in a smaller slot` : ""} and "${input.businessName}" in one small slot; leave every other text slot, label, tagline, number or caption out.`
    : `No words, letters or numbers in the picture${input.logo ? " besides the logo" : ""}.`;
  return [
    `Image 1 is a block map of a layout: grey shapes mark where the headline, the subject and the empty space sit. Follow its arrangement only; it has no style.${input.composition ? ` Composition: ${input.composition}` : ""}`,
    `Draw it as a ${cmoPictureKind(piece)}. ${input.pictureStyle}`,
    input.logo
      ? `Image 2 is ${input.businessName}'s logo. Place it exactly as drawn, exactly once, as part of the design (a masthead, a header or a footer); never redraw, restyle or recolour it, and never repeat it on signs or objects in the scene.`
      : "",
    own > 0
      ? `${own > 1 ? `Images ${firstOwn} and on are` : `Image ${firstOwn} is`} ${input.businessName}'s own picture${own > 1 ? "s" : ""} of its site or product. Set what the scene shows of it into the composition as it is: its layout, words and colours unchanged and readable. Invent no price, number, plan, label or interface detail it does not show.`
      : "",
    `Make an original ad for ${input.businessName}. Scene: ${piece.visual?.trim() ?? piece.title}.${slides > 1 ? " One picture of a series: the others share this same look. Draw no slide number, page number or counter." : ""}${slide ? ` This slide: ${slide}.` : ""}`,
    input.screen
      ? `Leave one plain, light, empty panel ${SCREEN_PANEL_WORDS}, with nothing drawn in it and no frame of your own: the brand's real screen is placed there afterwards. Draw no other screen, browser, phone, laptop, monitor or web page anywhere in the picture.`
      : "",
    slots,
    "Signs, papers, screens and objects in the scene carry no words.",
    `Draw no ${input.logo ? "other " : ""}logo, brand mark, emblem, coin symbol, signature or watermark.${input.logo ? "" : " Keep one corner plain: the brand's logo is placed there afterwards."}`,
    "Never a real, named person.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Brand pictures a styled picture may show inside its style. */
export const MAX_STYLE_BRAND_PICTURES = 2;

/** A number from the piece's id, so each piece starts somewhere else. */
function pieceSeed(piece: Pick<CmoMediaPiece, "id">): number {
  return [...piece.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

/**
 * The shot of a named page that fits the piece's shape: a tall (9:16) piece
 * shows the page on a phone, any other the desktop page or one of its best
 * sections, a different one per piece, so a month does not reuse one shot.
 * Any other picture stays as named.
 */
export function cmoShotForPiece(
  piece: CmoMediaPiece,
  fileId: string,
  brandPictures: readonly CmoBrandPicture[],
): string {
  const picture = brandPictures.find(
    (candidate) => candidate.fileId === fileId,
  );
  if (!picture) return fileId;
  if (aspectRatio(piece) === "9:16") return picture.phoneFileId ?? fileId;
  const wide = picture.wideFileIds ?? [];
  return wide[pieceSeed(piece) % wide.length] ?? fileId;
}

/** The pieces' named brand pictures, each as the shot that fits its shape. */
function namedShots(
  piece: CmoMediaPiece,
  brandPictures: readonly CmoBrandPicture[],
): string[] {
  const known = new Set(brandPictures.map((picture) => picture.fileId));
  return [
    ...new Set(
      (piece.visualFileIds ?? [])
        .filter((id) => known.has(id))
        .map((id) => cmoShotForPiece(piece, id, brandPictures)),
    ),
  ];
}

/**
 * The pictures a visual is made from: those it names, else the brand's own.
 * Each piece starts at another of them (by its id), so a month draws on
 * every section and photo of the site instead of the first one each time.
 */
/**
 * The brand's own pictures a short shows as they are, beside its scene: crops
 * of its site's sections and its photos. Its whole page comes from a live
 * capture.
 */
export function cmoShortPictures(
  piece: Pick<CmoMediaPiece, "id">,
  brandPictures: readonly CmoBrandPicture[],
): string[] {
  const own = brandPictures.filter((picture) => picture.kind !== "page");
  const start = own.length > 0 ? pieceSeed(piece) % own.length : 0;
  return [...own.slice(start), ...own.slice(0, start)]
    .slice(0, SHORT_BRAND_PICTURES)
    .map((picture) => picture.fileId);
}

function references(
  piece: CmoMediaPiece,
  all: readonly CmoBrandPicture[],
): string[] {
  // A short's scene is drawn from photos only: given a screenshot or a crop
  // of the site, the model redrew the page with made-up text (2026-11-22).
  const brandPictures = piece.shortFormat
    ? all.filter((picture) => picture.kind === "photo")
    : all;
  const named = namedShots(piece, brandPictures);
  if (named.length > 0) return named;
  const own = brandPictures.filter(
    (picture) => !picture.alt.endsWith("page screenshot"),
  );
  const start = own.length > 0 ? pieceSeed(piece) % own.length : 0;
  const turned = [...own.slice(start), ...own.slice(0, start)].map(
    (picture) => picture.fileId,
  );
  const home = piece.shortFormat
    ? undefined
    : brandPictures.find((picture) => picture.alt.startsWith("Home"));
  return [
    ...new Set([
      ...turned.slice(0, 1),
      ...(home ? [cmoShotForPiece(piece, home.fileId, brandPictures)] : []),
      ...turned.slice(1),
    ]),
  ].slice(0, DEFAULT_REFERENCES);
}

/**
 * The brand pictures a styled picture shows: only those its visual names.
 * Given the site's screenshot without a reason, Muse Image pasted the
 * homepage into six of six pictures that were not about it (2026-11-19).
 */
function styleBrandPictures(
  piece: CmoMediaPiece,
  brandPictures: readonly CmoBrandPicture[],
): string[] {
  return namedShots(piece, brandPictures).slice(0, MAX_STYLE_BRAND_PICTURES);
}

interface MediaContext {
  cuso: Pick<Cuso, "projectId" | "workspaceId" | "sokoBotId" | "businessName">;
  versionId: string;
  connected: ReadonlySet<string>;
  /**
   * Core schedules every finished post, words-only ones too (cmo-v6): Cuso
   * no longer schedules in a production run.
   */
  schedulesEveryPost?: boolean;
  /**
   * The Cuso's version picks each styled picture from five alternatives
   * (cmo-v11). `versionId` above is the approved strategy's, not the bot's.
   */
  picksPictures?: boolean;
}

/** The brand a styled picture is made and finished with. */
interface StyleBrand {
  colours: string[];
  /**
   * The logo placed on every styled picture: the full logo research saved,
   * else the Project's icon.
   */
  logo: Uint8Array | null;
  /** The full logo for a dark background, when the site has one. */
  darkLogo: Uint8Array | null;
  /**
   * The saved logo's Project file: sent as a styled picture's second image,
   * drawn into the design. Null when only the Project's icon is known.
   */
  logoFileId: string | null;
}

/** The brand's colours (DESIGN.md) and logo bytes, read once per run. */
export async function loadStyleBrand(projectId: string): Promise<StyleBrand> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { logo: true, designMdUrl: true },
  });
  const visual = project ? await cmoBrandVisual(project, []) : null;
  const saved = await readCmoBrandLogo(projectId);
  let logo = saved.logo;
  if (!logo && project?.logo) {
    const response = await fetch(project.logo, {
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (response?.ok) logo = new Uint8Array(await response.arrayBuffer());
  }
  return {
    colours: visual?.colors ?? [],
    logo,
    darkLogo: saved.dark,
    logoFileId: saved.fileId,
  };
}

/** Below this average brightness (0 to 255) a corner takes the light logo. */
const DARK_CORNER = 110;

/**
 * The logo for a picture: the dark-background one when the corner it goes
 * into is dark, so a black logo never lands on a black picture.
 */
export async function logoForPicture(
  picture: Uint8Array,
  style: Pick<StyleBrand, "logo" | "darkLogo">,
  corner: StudioLogoPosition = "bottom-right",
): Promise<Uint8Array | null> {
  if (!style.logo || !style.darkLogo) return style.logo;
  try {
    const { width = 0, height = 0 } = await sharp(picture).metadata();
    const area = {
      width: Math.max(1, Math.round(width * 0.26)),
      height: Math.max(1, Math.round(height * 0.19)),
    };
    const { channels } = await sharp(picture)
      .extract({
        left: corner.endsWith("right") ? width - area.width : 0,
        top: corner.startsWith("bottom") ? height - area.height : 0,
        ...area,
      })
      .greyscale()
      .stats();
    return (channels[0]?.mean ?? 255) < DARK_CORNER
      ? style.darkLogo
      : style.logo;
  } catch {
    return style.logo;
  }
}

/**
 * Moves every piece's media on: attaches what is ready, starts what is
 * missing within the studio's limit, and schedules a post once it has its
 * media on a connected network. Safe to call any time and from anywhere.
 */
export async function advanceCmoMedia(
  context: MediaContext,
  given: readonly CmoMediaPiece[],
): Promise<void> {
  const pieces = await withoutOutdatedPictures(context, given);
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
      (cmoPieceNeedsMedia(piece)
        ? cmoMediaState(piece, []) === "made"
        : context.schedulesEveryPost === true),
  );
  if (wanted.length === 0 && unscheduled.length === 0) return;
  const drive = await cusoDrive(context.cuso);
  if (!drive) return;
  for (const piece of unscheduled)
    await scheduleWhenComplete(context, drive, piece);
  if (wanted.length === 0) return;
  const { projectId } = context.cuso;
  const jobs = await listCmoMediaJobs(projectId, context.versionId);
  const picker = context.picksPictures === true;
  let capacity =
    (picker
      ? LIMITS.CMO_PICKED_MONTH_CONCURRENT_JOBS_PER_PROJECT
      : LIMITS.CMO_MONTH_CONCURRENT_JOBS_PER_PROJECT) -
    (await prisma.projectImageJob.count({
      where: { projectId, status: { in: [...LIVE] }, ...NOT_A_VIDEO_SHAPE_JOB },
    }));
  let brandPictures: CmoBrandPicture[] | null = null;
  let styleBrand: StyleBrand | null = null;
  const brandFor = async () => (styleBrand ??= await loadStyleBrand(projectId));
  const picks = picker
    ? await prisma.cmoPicturePick.findMany({
        where: { marketingStrategyId: context.versionId },
        select: {
          pieceId: true,
          slot: true,
          visualKey: true,
          chosenJobId: true,
        },
      })
    : [];
  const pickOf = (piece: CmoMediaPiece, slot: number) =>
    picks.find(
      (row) =>
        row.pieceId === piece.id &&
        row.slot === slot &&
        row.visualKey === cmoVisualKey(piece),
    ) ?? null;
  let look: string | null = null;
  const lookFor = async () => {
    if (look !== null) return look;
    const style = await cmoPictureStyle(projectId, (await brandFor()).colours);
    await chargeCheck(context, `cmo-picture-style:${projectId}`, style.costUsd);
    look = style.text;
    return look;
  };
  // Talking videos started in this pass, so its other posts wait for it.
  const started = new Set<string>();
  for (const piece of wanted) {
    // Slides go on in order, so the next one missing is always slot
    // media.length: a carousel once attached slides 2 and 3 while its cover
    // failed, and the cover was never tried again or handed back to Cuso.
    let inOrder = true;
    for (let slot = piece.media.length; slot < slotsOf(piece); slot += 1) {
      const pick = pickOf(piece, slot);
      let action = cmoSlotAction(piece, slotJobs(piece, slot, jobs), {
        picker: picker && styled(piece),
        pick,
      });
      if (action.kind === "pick") {
        const chosen = await pickPicture(
          context,
          drive,
          piece,
          slot,
          action.jobs,
          await brandFor(),
          await lookFor(),
        );
        action = chosen
          ? { kind: "attach", job: chosen }
          : {
              kind: "start",
              step: "image",
              attempt: "r1",
              sourceAssetId: null,
            };
      }
      if (action.kind === "attach") {
        if (inOrder) {
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
          // A remake that passed is the pick's choice once it is on the post.
          if (inOrder && action.job.attempt.startsWith("r"))
            await prisma.cmoPicturePick.updateMany({
              where: {
                marketingStrategyId: context.versionId,
                pieceId: piece.id,
                slot,
                visualKey: cmoVisualKey(piece),
                chosenJobId: null,
              },
              data: {
                chosenJobId: action.job.id,
                reason: `None of the alternatives passed the check; the remake on ${imageModel(cmoPickModel(action.job.attempt, aspectRatio(piece))).label} passed.`,
              },
            });
        }
        continue;
      }
      inOrder = false;
      if (action.kind !== "start" || capacity <= 0) continue;
      const startKey = jobKey(
        context.versionId,
        piece,
        slot,
        action.step,
        action.attempt,
      );
      if (started.has(startKey)) continue;
      started.add(startKey);
      brandPictures ??= await listCmoBrandPictures(projectId);
      // A cmo-v11 picture starts its alternatives together.
      const attempts =
        typeof action.attempt === "string" && action.attempt.startsWith("p")
          ? Array.from(
              {
                length:
                  PICK_MODELS.length - Number(action.attempt.slice(1)) + 1,
              },
              (_, index) =>
                `p${Number(action.attempt.toString().slice(1)) + index}`,
            )
          : [action.attempt];
      const layout =
        picker && styled(piece) && typeof action.attempt === "string"
          ? {
              composition: await composition(context, piece.styleReferenceId),
              pictureStyle: await lookFor(),
            }
          : null;
      for (const attempt of attempts) {
        if (capacity <= 0) break;
        const accepted = await start(context, drive, {
          piece,
          slot,
          layout,
          action: { ...action, attempt },
          // A styled picture's screen is placed by Core, never redrawn.
          references:
            action.step === "short"
              ? cmoShortPictures(piece, brandPictures)
              : action.step === "video" ||
                  action.step === "talking" ||
                  styled(piece)
                ? []
                : references(piece, brandPictures),
          screen:
            styled(piece) &&
            action.step === "image" &&
            styleBrandPictures(piece, brandPictures).length > 0,
          colours:
            styled(piece) &&
            action.step !== "video" &&
            action.step !== "talking"
              ? (await brandFor()).colours
              : [],
          logoFileId:
            styled(piece) &&
            action.step !== "video" &&
            action.step !== "talking"
              ? (await brandFor()).logoFileId
              : null,
        });
        // A refusal (credits, the hourly limit) stops starting, never
        // attaching: finished pictures further down still go on their posts.
        capacity = accepted ? capacity - 1 : 0;
      }
    }
  }
}

/** A reference's composition for a cmo-v11 picture, charged once when first written. */
async function composition(
  context: MediaContext,
  referenceId: string,
): Promise<string | null> {
  const { text, costUsd } = await referenceComposition(referenceId);
  await chargeCheck(
    context,
    `cmo-reference-composition:${referenceId}`,
    costUsd,
  );
  return text;
}

/** A model call made for a Cuso's pictures, on his bot's usage. */
async function chargeCheck(
  context: { cuso: Pick<Cuso, "sokoBotId"> },
  key: string,
  costUsd: number,
): Promise<void> {
  if (costUsd <= 0) return;
  await recordSokoBotCheckUsage({
    sokoBotId: context.cuso.sokoBotId,
    key,
    costUsd,
  });
}

/**
 * Checks every alternative of a cmo-v11 picture, has the check model pick
 * the best that passed side by side (the brief, the layout and the brand's
 * look), and records the pick with each alternative's verdict on its own
 * job. Returns the chosen job, or null when none passed and a remake is due.
 */
async function pickPicture(
  context: MediaContext,
  drive: CusoDrive,
  piece: CmoMediaPiece,
  slot: number,
  alternatives: readonly CmoMediaJob[],
  style: StyleBrand,
  look: string,
): Promise<CmoMediaJob | null> {
  const visualKey = cmoVisualKey(piece);
  const screen = await pieceScreen(context, drive, piece);
  const judged = await Promise.all(
    alternatives.map(async (job) => {
      if (job.status !== ProjectImageJobStatus.SUCCEEDED || !job.assetId)
        return null;
      const finished = await checkAndBrand(
        context,
        {
          styleReferenceId: piece.styleReferenceId,
          headline: cmoStyleHeadline(piece, slot) ?? undefined,
          visual: piece.slides?.[slot]?.trim() || piece.visual,
          lines: cmoStyleLines(piece, context.cuso.businessName),
          layoutOnly: true,
        },
        job,
        style,
        screen,
      );
      return finished === "rejected" ? null : { job, bytes: finished.bytes };
    }),
  );
  const passing = judged.filter((entry) => entry !== null);
  let chosen: CmoMediaJob | null = null;
  let reason = `None of the ${alternatives.length} alternatives passed the check.`;
  let costUsd = 0;
  if (passing.length === 1 && passing[0]) {
    chosen = passing[0].job;
    reason = `The only one of the ${alternatives.length} alternatives that passed the check.`;
  } else if (passing.length > 1 && piece.styleReferenceId) {
    const reference = await readReferenceImage(piece.styleReferenceId);
    try {
      const best = await pickBestPicture({
        candidates: passing.map((entry) => entry.bytes),
        layout: reference
          ? await layoutBlockMap(reference.bytes)
          : passing[0]!.bytes,
        brief: {
          scene: piece.visual ?? null,
          headline: cmoStyleHeadline(piece, slot),
          kind: cmoPictureKind(piece),
        },
        look,
      });
      chosen = passing[best.index]?.job ?? passing[0]!.job;
      reason = best.reason;
      costUsd = best.costUsd;
    } catch {
      // The picker failing never holds the picture back: the first that
      // passed goes on.
      chosen = passing[0]!.job;
      reason =
        "Picked the first alternative that passed; the picker did not answer.";
    }
  }
  const startedAt = alternatives.reduce(
    (first, job) => (job.createdAt < first ? job.createdAt : first),
    alternatives[0]?.createdAt ?? new Date(),
  );
  await prisma.cmoPicturePick.createMany({
    data: [
      {
        projectId: context.cuso.projectId,
        marketingStrategyId: context.versionId,
        pieceId: piece.id,
        slot,
        visualKey,
        candidateJobIds: alternatives.map((job) => job.id),
        chosenJobId: chosen?.id ?? null,
        reason,
        startedAt,
        costUsd,
      },
    ],
    skipDuplicates: true,
  });
  // Two passes racing: the first pick stored wins, and this one follows it.
  const stored = await prisma.cmoPicturePick.findUnique({
    where: {
      marketingStrategyId_pieceId_slot_visualKey: {
        marketingStrategyId: context.versionId,
        pieceId: piece.id,
        slot,
        visualKey,
      },
    },
    select: { id: true, chosenJobId: true },
  });
  if (stored && costUsd > 0)
    await chargeCheck(context, `cmo-picture-pick:${stored.id}`, costUsd);
  return stored?.chosenJobId
    ? (alternatives.find((job) => job.id === stored.chosenJobId) ?? null)
    : null;
}

/**
 * Whether a styled piece's picture was made for an older headline or
 * visual. Cuso rewrites them after the picture went on (6 of 20 of NMKR's
 * pictures, 2026-11-20, one lettered a fragment of an old headline), and a
 * piece with its picture was never looked at again.
 */
export function cmoPictureOutdated(
  piece: CmoMediaPiece,
  jobs: readonly CmoMediaJob[],
): boolean {
  if (!piece.styleReferenceId || piece.media.length === 0) return false;
  if (!cmoPieceTakesStyle(piece)) return false;
  const key = cmoVisualKey(piece);
  const own = jobs.filter(
    (job) => job.pieceId === piece.id && job.step === "image",
  );
  return (
    !own.some((job) => job.visualKey === key) &&
    own.some(
      (job) =>
        job.status === ProjectImageJobStatus.SUCCEEDED &&
        job.assetId !== null &&
        !job.rejected,
    )
  );
}

/**
 * Takes each outdated picture off its piece, so the next pass makes it
 * again: the post goes back to a draft at its time and is scheduled once
 * the new picture is on.
 */
async function withoutOutdatedPictures(
  context: MediaContext,
  pieces: readonly CmoMediaPiece[],
): Promise<readonly CmoMediaPiece[]> {
  const candidates = pieces.filter(
    (piece) =>
      piece.status !== "published" &&
      piece.status !== "skipped" &&
      piece.styleReferenceId &&
      piece.media.length > 0,
  );
  if (candidates.length === 0) return pieces;
  const jobs = await listCmoMediaJobs(
    context.cuso.projectId,
    context.versionId,
  );
  const outdated = new Set<string>();
  for (const piece of candidates) {
    if (!cmoPictureOutdated(piece, jobs)) continue;
    const dropped = piece.socialPostId
      ? await prisma.socialPost.updateMany({
          where: {
            id: piece.socialPostId,
            status: { in: ["DRAFT", "SCHEDULED", "NEEDS_APPROVAL"] },
          },
          data: {
            media: [],
            status: "DRAFT",
            scheduledByUserId: null,
            scheduledByCoworkerId: null,
            revision: { increment: 1 },
          },
        })
      : await prisma.marketingStrategyFile.updateMany({
          where: { marketingStrategyId: context.versionId, entryId: piece.id },
          data: { mediaFileIds: [] },
        });
    if (dropped.count > 0) outdated.add(piece.id);
  }
  return pieces.map((piece) =>
    outdated.has(piece.id)
      ? {
          ...piece,
          media: [],
          status: piece.status === "scheduled" ? "draft" : piece.status,
        }
      : piece,
  );
}

/**
 * Who speaks a talking video. The owner's photo needs their recorded
 * consent; without it, or with a presenter or voice no catalog has, a stock
 * presenter and voice speak instead, so the month is not held up.
 */
/** The stock voice a piece names, or the default one. */
function pieceVoice(piece: CmoMediaPiece) {
  return (SOKO_BOT_VOICEOVER_VOICES as readonly string[]).includes(
    piece.voice ?? "",
  )
    ? (piece.voice as (typeof SOKO_BOT_VOICEOVER_VOICES)[number])
    : DEFAULT_TALKING_VIDEO_VOICE;
}

async function talkingVoiceAndPresenter(
  context: MediaContext,
  drive: { workspaceId: string; userId: string },
  piece: CmoMediaPiece,
) {
  const voice = pieceVoice(piece);
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
    /** The brand's logo file, a styled picture's second image. */
    logoFileId?: string | null;
    /** A cmo-v11 picture: the reference's composition and the brand's look. */
    layout?: { composition: string | null; pictureStyle: string } | null;
    /** A styled picture leaves a panel for the brand's real screen. */
    screen?: boolean;
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
    forCmoMonth: true,
  };
  try {
    if (action.step === "talking") {
      await createTalkingVideoJob({
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        idempotencyKey,
        forCmoMonth: true,
        script: piece.script?.trim() ?? "",
        ...(await talkingVoiceAndPresenter(context, drive, piece)),
        languageCode: piece.languageCode ?? "en",
        // A month's videos carry music, and B-roll where the hook has room.
        music: true,
        broll: true,
      });
      return true;
    }
    if (action.step === "short") {
      if (!action.sourceAssetId || !piece.shortFormat) return true;
      await createShortVideoJob({
        ...scope,
        format: piece.shortFormat,
        script: piece.script?.trim() ?? "",
        hookLine: piece.hookLine ?? null,
        voice: pieceVoice(piece),
        languageCode: piece.languageCode ?? "en",
        // Its own scene first, then the brand's pictures; the site is
        // captured live, so no screenshot of it is among them.
        pictures: {
          assetIds: [action.sourceAssetId],
          fileIds: input.references,
        },
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
    // A styled picture's try picks its model: the next one after a refusal,
    // or a cmo-v11 alternative's own model.
    const style = styled(piece) ? piece.styleReferenceId : null;
    const picked = style && typeof action.attempt === "string" && input.layout;
    const model = imageModel(
      style
        ? typeof action.attempt === "string"
          ? cmoPickModel(action.attempt, aspectRatio(piece))
          : REFERENCE_STYLE_MODELS[
              (action.attempt - 1) % REFERENCE_STYLE_MODELS.length
            ]
        : undefined,
    );
    const logoFileId = style ? (input.logoFileId ?? null) : null;
    await createImageJob({
      ...scope,
      ...(picked
        ? {
            styleLayoutOnly: true,
            monthConcurrency:
              LIMITS.CMO_PICKED_MONTH_CONCURRENT_JOBS_PER_PROJECT,
          }
        : {}),
      prompt: picked
        ? cmoLayoutPrompt({
            piece,
            slot,
            businessName: context.cuso.businessName,
            screen: input.screen ?? false,
            composition: input.layout?.composition ?? null,
            pictureStyle: input.layout?.pictureStyle ?? "",
            logo: Boolean(logoFileId),
          })
        : style
          ? cmoStylePrompt({
              piece,
              slot,
              businessName: context.cuso.businessName,
              colours: input.colours,
              screen: input.screen ?? false,
              traits: await readStyleTraits(style),
              logo: Boolean(logoFileId),
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
      referenceFileIds: logoFileId
        ? [logoFileId, ...input.references]
        : input.references,
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
  const shaped = await videoInNetworkShape(context.cuso.projectId, piece, job);
  if (!shaped) return false;
  return await attachFile(context, drive, piece, shaped, style);
}

/**
 * A video piece's file in the shape its network shows it (`cmoVideoShape`):
 * the vertical video itself, or its other shape, which Core cuts from the
 * same parts for free. Null while that shape is being cut. A shape that
 * cannot be cut, or failed, leaves the vertical video: every network takes it.
 */
async function videoInNetworkShape(
  projectId: string,
  piece: CmoMediaPiece,
  job: CmoMediaJob,
): Promise<CmoMediaJob | null> {
  if (job.step !== "talking" && job.step !== "short") return job;
  const shape = cmoVideoShape(piece.channel, piece.format);
  if (shape === "9:16") return job;
  const cut = await prisma.projectImageJob.findUnique({
    where: {
      projectId_idempotencyKey: {
        projectId,
        idempotencyKey: videoShapeJobKey(job.id, shape),
      },
    },
    select: { id: true, status: true, asset: { select: { id: true } } },
  });
  if (!cut) return (await requestVideoShape(job.id, shape)) ? null : job;
  if (cut.status === ProjectImageJobStatus.SUCCEEDED && cut.asset)
    return { ...job, id: cut.id, assetId: cut.asset.id };
  return cut.status === ProjectImageJobStatus.FAILED ||
    cut.status === ProjectImageJobStatus.CANCELED
    ? job
    : null;
}

async function attachFile(
  context: MediaContext,
  drive: CusoDrive,
  piece: CmoMediaPiece,
  job: CmoMediaJob,
  style: StyleBrand | null,
): Promise<boolean> {
  if (!job.assetId) return false;
  const finished = style
    ? await checkAndBrand(
        context,
        {
          styleReferenceId: piece.styleReferenceId,
          headline: cmoStyleHeadline(piece, job.slot) ?? undefined,
          visual: piece.slides?.[job.slot]?.trim() || piece.visual,
          lines: cmoStyleLines(piece, context.cuso.businessName),
        },
        job,
        style,
        job.step === "image" ? await pieceScreen(context, drive, piece) : null,
      )
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
  // Cuso may schedule a post before its picture is made; it still gets it.
  if (!post || (post.status !== "DRAFT" && post.status !== "SCHEDULED"))
    return false;
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
  if (post.status === "DRAFT" && updated.media.length >= slotsOf(piece))
    await schedule(context, scope, { ...post, revision: updated.revision });
  return true;
}

/**
 * Checks a styled picture next to its reference and the brand pictures it
 * was made from (headline, nothing copied, nothing invented on the brand's
 * own page, brand colours, no stray marks, room for the logo) and places the
 * brand's logo on one that passes. A refusal marks the job, so the next
 * model tries.
 */
async function checkAndBrand(
  context: { cuso: Pick<Cuso, "sokoBotId"> },
  piece: Pick<CmoMediaPiece, "styleReferenceId" | "headline" | "visual"> & {
    /** Words it may letter besides the headline. */
    lines?: readonly string[];
    /** It borrowed only the reference's layout (cmo-v11). */
    layoutOnly?: boolean;
  },
  job: Pick<CmoMediaJob, "id" | "assetId">,
  style: StyleBrand,
  /** The brand's real screen, placed on the picture's panel before the check. */
  screen: Uint8Array | null = null,
): Promise<
  "rejected" | { bytes: Buffer; contentType: string; verdict: string }
> {
  const asset = await prisma.projectImageAsset.findUnique({
    where: { id: job.assetId ?? "" },
    select: { blobPathname: true, contentType: true },
  });
  const reference = piece.styleReferenceId
    ? await readReferenceImage(piece.styleReferenceId)
    : null;
  if (!asset || !reference) return "rejected";
  // One verdict per job: a pass that already judged it is followed.
  let judged = await jobVerdict(job.id);
  if (judged === "rejected") return "rejected";
  const made = await readAssetBytes(asset.blobPathname);
  const picture = screen
    ? asset.contentType === "image/png"
      ? await placeScreen(made, screen)
      : await sharp(await placeScreen(made, screen))
          .jpeg({ quality: 92 })
          .toBuffer()
    : made;
  // Sent as the second image only when it is the saved logo file.
  const logoSent = style.logoFileId ? style.logo : null;
  if (judged === null) {
    const check = await checkStyledPicture({
      picture,
      reference: reference.bytes,
      headline: piece.headline ?? null,
      lines: piece.lines ?? [],
      layoutOnly: piece.layoutOnly ?? false,
      logo: logoSent,
      scene: screen
        ? `${piece.visual ?? ""} ${PLACED_SCREEN_NOTE}`.trim()
        : (piece.visual ?? null),
      colours: style.colours,
      brandPictures: screen
        ? [screen]
        : await jobBrandPictures(job.id, style.logoFileId),
    });
    await recordSokoBotCheckUsage({
      sokoBotId: context.cuso.sokoBotId,
      key: `cmo-style-check:${job.id}`,
      costUsd: check.costUsd,
    });
    // Two passes once checked one job at the same time: the first passed and
    // put the picture on its post, the second refused and marked the job.
    // The first verdict stored wins, and a later one follows it.
    const verdict = check.passes
      ? cmoStylePassVerdict(
          check.verdict.logo === "correct" && logoSent
            ? "drawn"
            : (check.verdict.plainCorner ?? "bottom-right"),
        )
      : `${CMO_STYLE_REJECTED}${check.verdict.problems.join("; ").slice(0, 400) || "did not pass"}`;
    await prisma.projectImageJob.updateMany({
      where: { id: job.id, error: null },
      data: { error: verdict },
    });
    judged = (await jobVerdict(job.id)) ?? {
      passed: check.passes,
      error: verdict,
    };
  }
  if (judged === "rejected" || !judged.passed) return "rejected";
  const placement = cmoPassedLogo(judged.error);
  const logo =
    placement === "drawn"
      ? null
      : await logoForPicture(picture, style, placement);
  if (!logo) {
    return {
      bytes: Buffer.from(picture),
      contentType: asset.contentType,
      verdict: judged.error,
    };
  }
  const png = await renderStudioPng(picture, {
    logo: { bytes: logo, position: placement as StudioLogoPosition },
  });
  return asset.contentType === "image/png"
    ? { bytes: png, contentType: "image/png", verdict: judged.error }
    : {
        bytes: await sharp(png).jpeg({ quality: 90 }).toBuffer(),
        contentType: "image/jpeg",
        verdict: judged.error,
      };
}

/**
 * Told to the check when Core placed the screen: scenes name "hands holding
 * a phone showing the page", and the check refused Core's frame for hiding
 * the phone (2026-11-20).
 */
export const PLACED_SCREEN_NOTE =
  "(Core placed the brand's real page itself, in a plain browser window or phone in the middle: it stands in for any screen, phone or laptop this scene names.)";

/** The style verdict stored on a job, if a check already judged it. */
async function jobVerdict(
  jobId: string,
): Promise<"rejected" | { passed: boolean; error: string } | null> {
  const row = await prisma.projectImageJob.findUnique({
    where: { id: jobId },
    select: { error: true },
  });
  if (row?.error && cmoStylePassed(row.error))
    return { passed: true, error: row.error };
  if (row?.error?.startsWith(CMO_STYLE_REJECTED)) return "rejected";
  return null;
}

/** The brand's real screen a styled piece shows, if its visual names one. */
async function pieceScreen(
  context: MediaContext,
  drive: CusoDrive,
  piece: CmoMediaPiece,
): Promise<Uint8Array | null> {
  const [fileId] = styleBrandPictures(
    piece,
    await listCmoBrandPictures(context.cuso.projectId),
  );
  if (!fileId) return null;
  return downloadStudioFileReference(drive.workspaceId, fileId, {
    userId: drive.userId,
    organizationId: drive.organizationId,
    kind: "soko_bot",
  })
    .then((file) => file.bytes)
    .catch(() => null);
}

/** The brand's own pictures a styled job was made from (not its logo), for its check. */
async function jobBrandPictures(
  jobId: string,
  logoFileId: string | null,
): Promise<Uint8Array[]> {
  const job = await prisma.projectImageJob.findUnique({
    where: { id: jobId },
    select: {
      workspaceId: true,
      requestedByUserId: true,
      referenceFileIds: true,
      workspace: { select: { organizationId: true } },
    },
  });
  if (!job) return [];
  const pictures = await Promise.all(
    job.referenceFileIds
      .filter((fileId) => fileId !== logoFileId)
      .map((fileId) =>
        downloadStudioFileReference(job.workspaceId, fileId, {
          userId: job.requestedByUserId,
          organizationId: job.workspace.organizationId,
          kind: "soko_bot",
        })
          .then((file) => file.bytes)
          // A picture deleted since is not shown to the check, which is then
          // the stricter one: words from it count as extra.
          .catch(() => null),
      ),
  );
  return pictures.filter((bytes) => bytes !== null);
}

/**
 * A styled picture Cuso started in chat (generate_image with a
 * styleReferenceId), once its job has finished: the same check and logo as a
 * month's picture, with the finished file in Files. A picture the check
 * turned down says why, so the next model can try. Judged once: asking
 * again returns the same answer.
 */
export async function finishCmoChatPicture(input: {
  cuso: Pick<Cuso, "sokoBotId" | "projectId" | "businessName">;
  drive: { workspaceId: string; organizationId: string | null; userId: string };
  job: { id: string; assetId: string; prompt: string; error: string | null };
  styleReferenceId: string;
  headline: string | null;
  /** What Cuso asked the picture to show. */
  scene?: string | null;
}): Promise<
  | { passed: true; file: { id: string; name: string } }
  | { passed: false; problems: string }
> {
  const { job, drive } = input;
  if (job.error?.startsWith(CMO_STYLE_REJECTED))
    return {
      passed: false,
      problems: job.error.slice(CMO_STYLE_REJECTED.length),
    };
  const finished = cmoStylePassed(job.error)
    ? null
    : await checkAndBrand(
        input,
        {
          styleReferenceId: input.styleReferenceId,
          headline: input.headline ?? undefined,
          visual: input.scene ?? undefined,
          lines: [input.cuso.businessName],
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
      problems: row?.error?.startsWith(CMO_STYLE_REJECTED)
        ? row.error.slice(CMO_STYLE_REJECTED.length)
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
      data: { error: finished.verdict },
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

/**
 * Schedules a written post at its planned time on a connected network, or
 * hands it to the owner where the network wants each post confirmed.
 */
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
  if (!written || !context.connected.has(post.provider)) return;
  // TikTok asks the creator to confirm each video, so a made post waits for
  // the owner's tap instead of a schedule.
  if (isCmoOwnerConfirmedChannel(post.provider)) {
    await prisma.socialPost.updateMany({
      where: { id: post.id, status: "DRAFT", revision: post.revision },
      data: { status: "NEEDS_APPROVAL", revision: { increment: 1 } },
    });
    return;
  }
  if (!post.scheduledAt || post.scheduledAt.getTime() <= Date.now()) return;
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
