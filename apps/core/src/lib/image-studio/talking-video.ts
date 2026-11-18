import { SOKO_BOT_VOICEOVER_VOICES } from "@sokosumi/soko-bot";
import {
  creditsPerTalkingVideoCents,
  TALKING_VIDEO_SCRIPT_MAX_LENGTH,
  TALKING_VIDEO_SCRIPT_MIN_LENGTH,
  type TalkingVideoExtras,
  type TalkingVideoPriceFigures,
} from "@sokosumi/utils";
import sharp from "sharp";

import {
  type SpokenWord,
  TALKING_VIDEO_HOOK_MAX_LENGTH,
} from "./talking-video-edit";
import type { VideoSettings } from "./video-model";

/**
 * A talking video: a presenter photo speaking a script, edited and captioned.
 *
 * Three provider steps make one. The voice is spoken first, because its length
 * is the video's length, and transcribed for when each word is spoken. The
 * presenter model lip-syncs the photo to the voice. Core then edits the clip
 * itself (`talking-video-edit`): pauses cut, a punch-in per sentence, a hook
 * line and captions, from those word timings.
 *
 * The models are listed by hand, like the video catalog's verified layer:
 * fal's catalog fetch keeps prompt-driven video models only, and these take a
 * photo and a voice instead.
 */

/**
 * Times each spoken word of the voice. The voice model's own timings smear a
 * pause over the words around it, which is too coarse to cut or caption by.
 */
export const TALKING_VIDEO_WORDS_ENDPOINT =
  "fal-ai/elevenlabs/speech-to-text/scribe-v2";

/**
 * Cuts the presenter out of the clip, for standing them over the brand's
 * site. Asked for h264, it returns the clip and its matte as two files.
 */
export const TALKING_VIDEO_CUTOUT_ENDPOINT =
  "veed/video-background-removal/fast";

/**
 * Transcribes a video and burns the words in. Used only when the voice's
 * words could not be timed, so Core's own edit has nothing to plan from.
 */
export const TALKING_VIDEO_CAPTION_ENDPOINT =
  "fal-ai/workflow-utilities/auto-subtitle";

/**
 * What fal bills, read from its billing events (`/v1/models/billing-events`)
 * on 2026-11-18: one $0.05 unit per started second of a 1080p Turbo clip and
 * no minimum. Seven clips: 4.48 s was 5 units, 6.08 s 7, 9.68 s 10, 12.72 s
 * 13, 14.16 s 15. That is the model page's $0.05 per second. The standard
 * tier is left out until its billing is read the same way.
 */
const PRICES_VERIFIED_AT = "2026-11-18";
const VOICE_PER_1000_CHARACTERS_USD = 0.08;
/** Timing the spoken words for the captions, on `TALKING_VIDEO_WORDS_ENDPOINT`. */
const CAPTIONS_PER_MINUTE_USD = 0.008;
/** fal's price for `TALKING_VIDEO_CUTOUT_ENDPOINT`, per 30 frames. */
const CUTOUT_PER_30_FRAMES_USD = 0.008;

/** The only resolution sent. */
export const TALKING_VIDEO_RESOLUTION = "1080p";
export const TALKING_VIDEO_ASPECT_RATIO = "9:16";
const FRAME = { width: 1080, height: 1920 } as const;

export interface TalkingVideoModel {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  price: TalkingVideoPriceFigures & {
    basis: string;
    sourceUrl: string;
    verifiedAt: string;
  };
}

const MODELS: TalkingVideoModel[] = [
  {
    id: "avatar-6-turbo",
    label: "HeyGen Avatar 6 Turbo",
    description: "A presenter speaking your script.",
    endpoint: "heygen/avatar-6/turbo/image-to-video",
    price: {
      perSecondUsd: 0.05,
      voicePer1000CharactersUsd: VOICE_PER_1000_CHARACTERS_USD,
      captionsPerMinuteUsd: CAPTIONS_PER_MINUTE_USD,
      // fal billed 18 units for a 14.16 s clip of this model (354 frames at
      // 25 a second), on 2026-11-18: one and a half units per 30 frames.
      cutoutPerSecondUsd: (CUTOUT_PER_30_FRAMES_USD * 18) / 14.16,
      basis:
        "$0.05 per started second of video at 1080p, as fal's billing events show, plus the voice ($0.08 per 1,000 characters) and timing its words for the captions ($0.008 per minute). Showing the brand's site behind the presenter adds the cut-out (about $0.01 per second, as fal billed a measured clip). The edit itself is made by Core and costs nothing.",
      sourceUrl: "https://fal.ai/models/heygen/avatar-6/turbo/image-to-video",
      verifiedAt: PRICES_VERIFIED_AT,
    },
  },
];

export const DEFAULT_TALKING_VIDEO_MODEL_ID = "avatar-6-turbo";

export interface TalkingVideoPresenter {
  id: string;
  name: string;
  /** Who this presenter reads as, for choosing one that fits an audience. */
  description: string;
  /** A public 9:16 portrait. Generated: no presenter is a real person. */
  imageUrl: string;
}

const PRESENTER_BASE_URL =
  "https://igcd4cnfvuav1zto.public.blob.vercel-storage.com/vendor/talking-video/presenters";

function presenter(
  id: string,
  name: string,
  description: string,
): TalkingVideoPresenter {
  return { id, name, description, imageUrl: `${PRESENTER_BASE_URL}/${id}.jpg` };
}

export const TALKING_VIDEO_PRESENTERS: TalkingVideoPresenter[] = [
  presenter("maya", "Maya", "Woman in her late twenties, casual, at home."),
  presenter("jonas", "Jonas", "Man in his thirties, casual, in a home office."),
  presenter("aisha", "Aisha", "Woman in her thirties, smart, in an office."),
  presenter("leo", "Leo", "Man in his early twenties, relaxed, in a studio."),
  presenter("elena", "Elena", "Woman in her forties, warm, in a kitchen."),
  presenter("david", "David", "Man in his fifties, calm, in a workshop."),
  presenter("mei", "Mei", "Woman in her twenties, bright, in a café."),
  presenter("omar", "Omar", "Man in his forties, friendly, in a shop."),
];

export const DEFAULT_TALKING_VIDEO_VOICE =
  "Sarah" satisfies (typeof SOKO_BOT_VOICEOVER_VOICES)[number];

export interface TalkingVideoCatalog {
  defaultModelId: string;
  models: TalkingVideoModel[];
  presenters: TalkingVideoPresenter[];
  defaultVoice: string;
  voices: readonly string[];
  scriptMinLength: number;
  scriptMaxLength: number;
}

export function getTalkingVideoCatalog(): TalkingVideoCatalog {
  return {
    defaultModelId: DEFAULT_TALKING_VIDEO_MODEL_ID,
    models: MODELS,
    presenters: TALKING_VIDEO_PRESENTERS,
    defaultVoice: DEFAULT_TALKING_VIDEO_VOICE,
    voices: SOKO_BOT_VOICEOVER_VOICES,
    scriptMinLength: TALKING_VIDEO_SCRIPT_MIN_LENGTH,
    scriptMaxLength: TALKING_VIDEO_SCRIPT_MAX_LENGTH,
  };
}

/** The model for an id, or the default when no id is given. */
export function talkingVideoModel(id?: string): TalkingVideoModel {
  const wanted = id ?? DEFAULT_TALKING_VIDEO_MODEL_ID;
  const model = MODELS.find((candidate) => candidate.id === wanted);
  if (!model) throw new Error("Unknown talking video model.");
  return model;
}

/** The model a stored job names, for pricing it again. */
export function talkingVideoModelForEndpoint(
  endpoint: string,
): TalkingVideoModel {
  const model = MODELS.find((candidate) => candidate.endpoint === endpoint);
  if (!model) throw new Error("Unknown talking video model.");
  return model;
}

export function findTalkingVideoPresenter(
  id: string,
): TalkingVideoPresenter | null {
  return (
    TALKING_VIDEO_PRESENTERS.find((candidate) => candidate.id === id) ?? null
  );
}

/** Credits (= cents) for one talking video of this script on this model. */
export function creditsPerTalkingVideo(
  model: TalkingVideoModel,
  script: string,
  extras: TalkingVideoExtras = {},
): number {
  return creditsPerTalkingVideoCents(model.price, script, extras);
}

/**
 * Phrases a customer says about a product they bought or used. A generated
 * presenter saying them is an invented testimonial.
 */
const CUSTOMER_TESTIMONIAL_PATTERNS = [
  /\bas an? (happy |loyal |long[- ]time |real )?(customer|client|user|patient|buyer)\b/i,
  /\bi(['’]ve| have) been (using|a customer|buying|taking)\b/i,
  /\bi (bought|ordered|purchased|tried|switched to|started using|signed up for)\b/i,
  /\b(since|after|before) i (started|began|tried|bought|switched)\b/i,
  /\b(changed|saved|transformed) my (life|business|skin|sleep|health)\b/i,
  /\bals (kundin|kunde|nutzerin|nutzer)\b/i,
  /\bich (habe|hab) .{0,40}(gekauft|bestellt|ausprobiert|getestet)\b/i,
  /\bseit ich .{0,40}(nutze|benutze|verwende|nehme)\b/i,
  /\bcomo (cliente|usuaria|usuario)\b/i,
  /\b(compré|probé|llevo .{0,20}(usando|tomando))\b/i,
];

/**
 * True when a script speaks as a customer of the product. A talking video
 * shows a generated person, so it may speak for the brand but never give a
 * customer's account of it.
 */
export function posesAsCustomerTestimonial(script: string): boolean {
  return CUSTOMER_TESTIMONIAL_PATTERNS.some((pattern) => pattern.test(script));
}

export const TALKING_VIDEO_TESTIMONIAL_MESSAGE =
  "A talking video shows a generated presenter, so it cannot speak as a customer. Write it in the brand's own voice.";

/** A talking video's stored settings: a video's, plus who speaks and how. */
export interface TalkingVideoSettings extends VideoSettings {
  voice: string;
  /** A stock presenter, or null when the photo is the job's reference File. */
  presenterId: string | null;
  /** ISO 639-1 language of the script. */
  languageCode: string;
  /** When each word of the voice is spoken. Empty when they were not timed. */
  words: SpokenWord[];
  /** A few words shown over the first seconds, or null for none. */
  hookLine: string | null;
  /** The middle sentences show the brand's site. */
  siteShots: boolean;
  /** The site's screenshot in the studio's store, once it is taken. */
  sitePagePathname: string | null;
}

function readSpokenWords(value: unknown): SpokenWord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((word: unknown) => {
    if (typeof word !== "object" || word === null) return [];
    const { text, start, end } = word as Record<string, unknown>;
    return typeof text === "string" &&
      typeof start === "number" &&
      typeof end === "number"
      ? [{ text, start, end }]
      : [];
  });
}

export function readTalkingVideoSettings(value: unknown): TalkingVideoSettings {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    aspectRatio: TALKING_VIDEO_ASPECT_RATIO,
    durationSeconds:
      typeof raw.durationSeconds === "number" ? raw.durationSeconds : 0,
    resolution: TALKING_VIDEO_RESOLUTION,
    voice: typeof raw.voice === "string" ? raw.voice : "",
    presenterId: typeof raw.presenterId === "string" ? raw.presenterId : null,
    languageCode:
      typeof raw.languageCode === "string" ? raw.languageCode : "en",
    words: readSpokenWords(raw.words),
    hookLine:
      typeof raw.hookLine === "string" && raw.hookLine.trim()
        ? raw.hookLine.trim().slice(0, TALKING_VIDEO_HOOK_MAX_LENGTH)
        : null,
    siteShots: raw.siteShots === true,
    sitePagePathname:
      typeof raw.sitePagePathname === "string" ? raw.sitePagePathname : null,
  };
}

/**
 * A person's own photo, cut to the 9:16 frame the video is made in. The
 * presenter model follows its photo's shape, and a landscape selfie would
 * otherwise come back as a landscape video.
 */
export async function frameTalkingVideoPresenter(
  bytes: Uint8Array,
): Promise<Uint8Array> {
  return await sharp(bytes)
    .rotate()
    .resize(FRAME.width, FRAME.height, { fit: "cover", position: "attention" })
    .jpeg({ quality: 92 })
    .toBuffer();
}

export function buildTalkingVideoInput(input: {
  imageUrl: string;
  audioUrl: string;
}): Record<string, unknown> {
  return {
    image_url: input.imageUrl,
    audio_url: input.audioUrl,
    resolution: TALKING_VIDEO_RESOLUTION,
  };
}

/**
 * Bold white words, two at a time, the spoken one in yellow. On this endpoint a
 * positive `y_offset` lifts bottom captions and 200 is its most: about three
 * quarters of the frame's height, which is still below TikTok's safe area.
 * Core's own edit places them inside it; this is the fallback's best.
 */
export function buildTalkingVideoCutoutInput(input: {
  videoUrl: string;
}): Record<string, unknown> {
  return { video_url: input.videoUrl, output_codec: "h264" };
}

export function buildTalkingVideoCaptionInput(input: {
  videoUrl: string;
  languageCode: string;
}): Record<string, unknown> {
  return {
    video_url: input.videoUrl,
    language: input.languageCode,
    font_name: "Montserrat",
    font_weight: "black",
    font_size: 64,
    font_color: "white",
    highlight_color: "yellow",
    stroke_color: "black",
    stroke_width: 4,
    position: "bottom",
    y_offset: 200,
    words_per_subtitle: 2,
  };
}
