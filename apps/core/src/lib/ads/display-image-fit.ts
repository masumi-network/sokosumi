import sharp from "sharp";

import {
  GOOGLE_DISPLAY_IMAGE_MAX_BYTES,
  GOOGLE_DISPLAY_IMAGE_MAX_LABEL,
  GOOGLE_DISPLAY_IMAGE_MIME_TYPES,
  type GoogleDisplayImage,
  type GoogleDisplayImageRole,
} from "@/lib/ads/campaigns";

/** Google refuses a LANDSCAPE image more than 1% off 1.91:1; SQUARE and LOGO must be 1:1. */
const TARGET_RATIO: Record<GoogleDisplayImageRole, number> = {
  LANDSCAPE: 1.91,
  SQUARE: 1,
  LOGO: 1,
};
const RATIO_TOLERANCE = 0.01;
const LOGO_MIN_SIDE = 128;

export type DisplayImageFit =
  | { kind: "unchanged"; mimeType: GoogleDisplayImage["mimeType"] }
  | { kind: "cropped"; bytes: Uint8Array; width: number; height: number }
  | { kind: "refused"; reason: string };

const UNREADABLE: DisplayImageFit = {
  kind: "refused",
  reason: "it is not a readable image",
};

/**
 * Centre-crops an image to its role's ratio, without scaling, as a JPEG.
 * Sizes are as displayed, after EXIF rotation. An image Google already
 * accepts as it is stays `unchanged`.
 */
export async function fitDisplayImage(
  bytes: Uint8Array,
  mimeType: string,
  role: GoogleDisplayImageRole,
): Promise<DisplayImageFit> {
  const meta = await sharp(bytes)
    .metadata()
    .catch(() => null);
  const { width = 0, height = 0 } = meta?.autoOrient ?? {};
  if (width === 0 || height === 0) return UNREADABLE;
  if (role === "LOGO" && Math.min(width, height) < LOGO_MIN_SIDE)
    return {
      kind: "refused",
      reason: `a logo must be at least ${LOGO_MIN_SIDE}x${LOGO_MIN_SIDE} px; this one is ${width}x${height}`,
    };

  const target = TARGET_RATIO[role];
  const ratio = width / height;
  const fits = Math.abs(ratio - target) / target <= RATIO_TOLERANCE;
  const upright = (meta?.orientation ?? 1) === 1;
  const accepted = GOOGLE_DISPLAY_IMAGE_MIME_TYPES.find((m) => m === mimeType);
  if (fits && upright && accepted)
    return { kind: "unchanged", mimeType: accepted };

  const cropWidth = ratio > target ? Math.round(height * target) : width;
  const cropHeight = ratio > target ? height : Math.round(width / target);
  const output = await sharp(bytes)
    .autoOrient()
    .extract({
      left: Math.floor((width - cropWidth) / 2),
      top: Math.floor((height - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
    })
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true })
    .catch(() => null);
  if (!output) return UNREADABLE;
  const { data, info } = output;
  if (data.byteLength > GOOGLE_DISPLAY_IMAGE_MAX_BYTES)
    return {
      kind: "refused",
      reason: `the cropped image is over Google's ${GOOGLE_DISPLAY_IMAGE_MAX_LABEL} limit`,
    };
  return {
    kind: "cropped",
    bytes: data,
    width: info.width,
    height: info.height,
  };
}
