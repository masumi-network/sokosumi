import { creditsPerVideoCents } from "@sokosumi/utils";

/**
 * What a studio video model *is*: its vocabulary and the rules that hold for one
 * model in isolation. The video counterpart of {@link ./image-model}; which
 * models exist is {@link ./video-catalog}.
 */

/** Frames the studio offers for text-to-video. 9:16 first: Reels, Shorts, TikTok. */
export const VIDEO_ASPECT_RATIOS = [
  "9:16",
  "16:9",
  "1:1",
  "4:3",
  "3:4",
] as const;

/** Lengths the studio offers, in seconds. */
export const VIDEO_DURATIONS_SECONDS = [5, 10, 15] as const;

/** Fast and cheap text-to-video. */
export const DEFAULT_VIDEO_MODEL_ID = "h3-max-turbo";
/** The same model family, animating a still the person already has. */
export const DEFAULT_ANIMATE_MODEL_ID = "h3-max-turbo-animate";
/** The quality step up from each default, at twice the price. */
export const HIGH_QUALITY_VIDEO_MODEL_ID = "h3-max";
export const HIGH_QUALITY_ANIMATE_MODEL_ID = "h3-max-animate";

export interface VideoSettings {
  aspectRatio: string;
  durationSeconds: number;
  /** The provider's own resolution value, e.g. `768P` or `720p`. */
  resolution: string;
}

export interface VideoPrice {
  /** fal's pricing-API figure, verbatim. Informational: see `perSecondUsd`. */
  unit: string;
  unitPriceUsd: number;
  /**
   * USD per second by resolution, read off the model page by a person. The only
   * figure billed: fal's pricing API reports the cheapest tier, not the default.
   */
  perSecondUsd?: Partial<Record<string, number>>;
  basis: string;
  sourceUrl: string;
  verifiedAt: string;
}

export interface VideoModel {
  id: string;
  label: string;
  description: string;
  endpoint: string;
  /** `text` generates from a prompt; `image` animates a still it is handed. */
  input: "text" | "image";
  /** The provider field the still goes in. Null for text-to-video. */
  imageField: string | null;
  /**
   * Frames the studio may ask for. Empty means none is sent: an image-to-video
   * model follows its still.
   */
  aspectRatios: readonly string[];
  /** Lengths from {@link VIDEO_DURATIONS_SECONDS} this endpoint accepts. */
  durations: readonly number[];
  /** fal schemas take `duration` as a number or as an enum of strings. */
  durationEncoding: "number" | "string";
  /** Resolutions offered, first is the default. Always sent: price follows it. */
  resolutions: readonly string[];
  /** Required provider fields the studio has no control for, sent at their default. */
  fixedInput: Record<string, string | number | boolean>;
  /** 1-n for the curated shortlist, in order. Null for everything else. */
  curatedRank: number | null;
  notes: string;
  price: VideoPrice;
  sourceUrls: string[];
  verifiedAt: string;
}

/** What a request with no settings gets on this model. */
export function defaultVideoSettings(model: VideoModel): VideoSettings {
  return {
    aspectRatio: model.aspectRatios.includes("9:16")
      ? "9:16"
      : (model.aspectRatios[0] ?? ""),
    durationSeconds: model.durations.includes(5)
      ? 5
      : (model.durations[0] ?? 5),
    resolution: model.resolutions[0] ?? "",
  };
}

/**
 * Check settings against one model and return the settings it will be sent.
 *
 * A throw, like `validateImageSettings`: every caller is about to reserve a row
 * or spend money, and the message is what the person reads.
 */
export function validateVideoSettings(
  model: VideoModel,
  settings: VideoSettings,
  hasSourceImage: boolean,
): VideoSettings {
  if (model.input === "image" && !hasSourceImage)
    throw new Error(`${model.label} animates an image. Choose one first.`);
  if (model.input === "text" && hasSourceImage)
    throw new Error(
      `${model.label} makes a video from text. Choose an image-to-video model to animate an image.`,
    );
  if (!model.durations.includes(settings.durationSeconds))
    throw new Error(`${model.label} does not support this length.`);
  if (!model.resolutions.includes(settings.resolution))
    throw new Error(`${model.label} does not support this resolution.`);
  if (
    model.aspectRatios.length > 0 &&
    !model.aspectRatios.includes(settings.aspectRatio)
  )
    throw new Error(`${model.label} does not support this aspect ratio.`);
  return {
    // Empty when the frame follows the still, so no row claims a ratio it was not made at.
    aspectRatio: model.aspectRatios.length > 0 ? settings.aspectRatio : "",
    durationSeconds: settings.durationSeconds,
    resolution: settings.resolution,
  };
}

/** Credits (= cents) for one video on these settings. Throws when unpriceable. */
export function creditsPerVideo(
  model: VideoModel,
  settings: Pick<VideoSettings, "durationSeconds" | "resolution">,
): number {
  const cents = creditsPerVideoCents(model.price, settings);
  if (cents === null)
    throw new Error(
      `${model.label} has no verified price at ${settings.resolution}, so it cannot be charged for.`,
    );
  return cents;
}

/** True when some offered resolution has no verified per-second price. */
export function isUnchargeableVideoModel(model: VideoModel): boolean {
  if (model.resolutions.length === 0) return true;
  return model.resolutions.some(
    (resolution) =>
      creditsPerVideoCents(model.price, {
        resolution,
        durationSeconds: model.durations[0] ?? 5,
      }) === null,
  );
}

/** The provider payload for one video. Only fields the schema declares are sent. */
export function buildFalVideoInput(
  model: VideoModel,
  input: { prompt: string; settings: VideoSettings; imageUrl: string | null },
): Record<string, unknown> {
  const settings = validateVideoSettings(
    model,
    input.settings,
    input.imageUrl !== null,
  );
  const body: Record<string, unknown> = {
    ...model.fixedInput,
    prompt: input.prompt,
    duration:
      model.durationEncoding === "string"
        ? String(settings.durationSeconds)
        : settings.durationSeconds,
    resolution: settings.resolution,
  };
  if (model.aspectRatios.length > 0) body.aspect_ratio = settings.aspectRatio;
  if (model.imageField && input.imageUrl)
    body[model.imageField] = input.imageUrl;
  return body;
}
