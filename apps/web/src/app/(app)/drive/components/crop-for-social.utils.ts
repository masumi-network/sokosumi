import { DRIVE_FILE_MAX_NAME_LENGTH } from "@sokosumi/utils";

/** The shapes social networks ask for, widest last. */
export const SOCIAL_SHAPES = [
  { id: "square", ratio: 1, label: "1x1" },
  { id: "portrait", ratio: 4 / 5, label: "4x5" },
  { id: "story", ratio: 9 / 16, label: "9x16" },
  { id: "landscape", ratio: 1.91, label: "1.91x1" },
] as const;

export type SocialShape = (typeof SOCIAL_SHAPES)[number];
export type SocialShapeId = SocialShape["id"];

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The axis the frame slides along; null when the image already fits. */
  axis: "x" | "y" | null;
}

/**
 * The largest frame of the shape inside the image, `position` (0..1) along the
 * one axis it can slide. Whole pixels, so the canvas copies no half pixels.
 */
export function cropRect(
  imageWidth: number,
  imageHeight: number,
  shape: SocialShape,
  position: number,
): CropRect {
  const at = Math.min(1, Math.max(0, position));
  const fitWidth = Math.round(imageHeight * shape.ratio);
  if (fitWidth < imageWidth) {
    return {
      x: Math.round((imageWidth - fitWidth) * at),
      y: 0,
      width: fitWidth,
      height: imageHeight,
      axis: "x",
    };
  }
  const fitHeight = Math.round(imageWidth / shape.ratio);
  if (fitHeight < imageHeight) {
    return {
      x: 0,
      y: Math.round((imageHeight - fitHeight) * at),
      width: imageWidth,
      height: fitHeight,
      axis: "y",
    };
  }
  return { x: 0, y: 0, width: imageWidth, height: imageHeight, axis: null };
}

/**
 * Where a pointer on the photo puts the frame, as a `cropRect` position.
 * Fractions run along the frame's axis: `at` is the pointer, `frame` the
 * frame's length. With a `start` (the frame was grabbed) the frame follows the
 * pointer's travel; without one it centres on the pointer, as after a tap.
 */
export function dragPosition({
  at,
  frame,
  start,
}: {
  at: number;
  frame: number;
  start: { at: number; position: number } | null;
}): number {
  const travel = 1 - frame;
  if (travel <= 0) return 0;
  const position = start
    ? start.position + (at - start.at) / travel
    : (at - frame / 2) / travel;
  return Math.min(1, Math.max(0, position));
}

const CROPPABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Photos only: SVG has no fixed pixels and a GIF would lose its frames. */
export function isCroppableImage(type: string): boolean {
  return CROPPABLE_TYPES.has(type);
}

/** JPEG stays JPEG; PNG and WebP, which may be transparent, save as PNG. */
export function croppedType(type: string): "image/png" | "image/jpeg" {
  return type === "image/jpeg" ? "image/jpeg" : "image/png";
}

/**
 * The copy's name: the original's, with the shape and the saved type's
 * extension. The base is shortened so the whole name stays within Drive's
 * limit, which a long original name would otherwise break on every save.
 */
export function croppedFileName(
  name: string,
  shape: SocialShape,
  type: string,
): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = croppedType(type) === "image/png" ? "png" : "jpg";
  const suffix = `-${shape.label}.${extension}`;
  return `${base.slice(0, DRIVE_FILE_MAX_NAME_LENGTH - suffix.length)}${suffix}`;
}

/**
 * Core streams a Drive file up to this size and hands a bigger one to signed
 * storage, whose bytes a canvas may draw but never export. Matches
 * `STREAM_MAX_BYTES` in Core's `drive/files/content` route.
 */
export const CROP_MAX_BYTES = 25 * 1024 * 1024;
