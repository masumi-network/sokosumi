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

const CROPPABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Photos only: SVG has no fixed pixels and a GIF would lose its frames. */
export function isCroppableImage(type: string): boolean {
  return CROPPABLE_TYPES.has(type);
}

/** JPEG stays JPEG; PNG and WebP, which may be transparent, save as PNG. */
export function croppedType(type: string): "image/png" | "image/jpeg" {
  return type === "image/jpeg" ? "image/jpeg" : "image/png";
}

export function croppedFileName(
  name: string,
  shape: SocialShape,
  type: string,
): string {
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = croppedType(type) === "image/png" ? "png" : "jpg";
  return `${base}-${shape.label}.${extension}`;
}

/**
 * The folder a Drive file sits in, as upload takes it: the path below
 * `drive/<users|orgs>/<id>/`. Undefined at the root or outside Drive.
 */
export function folderOfDrivePathname(pathname: string): string | undefined {
  const parts = pathname.split("/");
  if (parts[0] !== "drive" || parts.length <= 4) return undefined;
  return parts.slice(3, -1).join("/");
}
