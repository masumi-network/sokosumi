import { SOKO_BOT_VOICEOVER_VOICES } from "@sokosumi/soko-bot";
import {
  creditsPerTalkingVideoCents,
  TALKING_VIDEO_SCRIPT_MAX_LENGTH,
  TALKING_VIDEO_SCRIPT_MIN_LENGTH,
  type TalkingVideoPriceFigures,
} from "@sokosumi/utils";
import sharp from "sharp";

import type { VideoSettings } from "./video-model";

/**
 * A talking video: a presenter photo speaking a script, with captions.
 *
 * Three provider steps make one. The voice is spoken first, because its length
 * is the video's length. The presenter model lip-syncs the photo to it. A
 * caption step then burns the spoken words into the picture.
 *
 * The models are listed by hand, like the video catalog's verified layer:
 * fal's catalog fetch keeps prompt-driven video models only, and these take a
 * photo and a voice instead.
 */

/** Transcribes the finished video and burns the words in. */
export const TALKING_VIDEO_CAPTION_ENDPOINT =
  "fal-ai/workflow-utilities/auto-subtitle";

/**
 * Measured, not read off the model page. The page says $0.05 per second at
 * 1080p; fal billed a 6.08 s Turbo clip 22 units at $0.05, so $1.10, on
 * 2026-11-18. With one measurement it is unknown whether part of that is a
 * fixed charge, so a video costs the larger of $1.10 and that clip's rate
 * per second: an upper bound either way. The standard tier is left out until
 * its price is measured too.
 */
const PRICES_VERIFIED_AT = "2026-11-18";
const VOICE_PER_1000_CHARACTERS_USD = 0.08;
const CAPTIONS_PER_MINUTE_USD = 0.03;

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
      perSecondUsd: 0.181,
      minimumVideoUsd: 1.1,
      voicePer1000CharactersUsd: VOICE_PER_1000_CHARACTERS_USD,
      captionsPerMinuteUsd: CAPTIONS_PER_MINUTE_USD,
      basis:
        "The larger of $1.10 and $0.181 per second of video at 1080p, from what fal billed for a measured clip, plus the voice ($0.08 per 1,000 characters) and the captions ($0.03 per minute).",
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
): number {
  return creditsPerTalkingVideoCents(model.price, script);
}

/** A talking video's stored settings: a video's, plus who speaks and how. */
export interface TalkingVideoSettings extends VideoSettings {
  voice: string;
  /** A stock presenter, or null when the photo is the job's reference File. */
  presenterId: string | null;
  /** ISO 639-1 language of the script. */
  languageCode: string;
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
 * positive `y_offset` lifts bottom captions: 200 puts them at about three
 * quarters of the frame's height, above the app's own caption and buttons.
 */
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
