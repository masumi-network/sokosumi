import {
  SHORT_VIDEO_FORMATS,
  SHORT_VIDEO_TEXT_FORMATS,
  type ShortVideoFormat,
} from "./talking-video-credits.js";

/**
 * The shapes a video is cut in. One recipe makes each of them from the same
 * paid parts (presenter, voice, B-roll, music): every extra shape is one more
 * edit, not one more generation.
 */
export const VIDEO_SHAPES = ["9:16", "4:5", "1:1", "16:9"] as const;
export type VideoShape = (typeof VIDEO_SHAPES)[number];

export const DEFAULT_VIDEO_SHAPE: VideoShape = "9:16";

export const VIDEO_SHAPE_FRAMES: Record<
  VideoShape,
  { width: number; height: number }
> = {
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

export const VIDEO_SHAPE_LABELS: Record<VideoShape, string> = {
  "9:16": "Vertical",
  "4:5": "Feed",
  "1:1": "Square",
  "16:9": "Widescreen",
};

/** A video with a presenter, or one of the shorts without one. */
export const VIDEO_KINDS = ["presenter", ...SHORT_VIDEO_FORMATS] as const;
export type VideoKind = (typeof VIDEO_KINDS)[number];

/** What a recipe cannot be made without. */
export interface VideoRecipeNeeds {
  presenter?: boolean;
  website?: boolean;
  /** The fewest of the brand's own pictures it takes. */
  pictures?: number;
  /** The real date of what it announces. */
  launchDate?: boolean;
}

export interface VideoRecipe {
  kind: VideoKind;
  needs: VideoRecipeNeeds;
  /** A voice speaks the script; otherwise its lines are shown on screen. */
  spoken: boolean;
  /** The shapes its shots read well in. */
  shapes: readonly VideoShape[];
}

const short = (
  format: ShortVideoFormat,
  needs: VideoRecipeNeeds,
  shapes: readonly VideoShape[] = VIDEO_SHAPES,
): VideoRecipe => ({
  kind: format,
  needs,
  spoken: !SHORT_VIDEO_TEXT_FORMATS.includes(format),
  shapes,
});

export const VIDEO_RECIPES: Record<VideoKind, VideoRecipe> = {
  presenter: {
    kind: "presenter",
    needs: { presenter: true },
    spoken: true,
    shapes: VIDEO_SHAPES,
  },
  voiceover: short("voiceover", {}),
  // A page captured for a phone is too tall to read in a square.
  site_tour: short("site_tour", { website: true }, ["9:16", "4:5", "16:9"]),
  top_three: short("top_three", {}),
  slideshow: short("slideshow", { pictures: 1 }),
  launch: short("launch", { launchDate: true }),
};

/** The recipe a stored job follows: a short's format, or the presenter's. */
export function videoRecipeFor(format: ShortVideoFormat | null): VideoRecipe {
  return VIDEO_RECIPES[format ?? "presenter"];
}

/** The wanted shapes a recipe can make, in `VIDEO_SHAPES` order, never none. */
export function videoShapesFor(
  recipe: VideoRecipe,
  wanted: readonly VideoShape[],
): VideoShape[] {
  const shapes = VIDEO_SHAPES.filter(
    (shape) => wanted.includes(shape) && recipe.shapes.includes(shape),
  );
  return shapes.length > 0 ? shapes : [DEFAULT_VIDEO_SHAPE];
}
