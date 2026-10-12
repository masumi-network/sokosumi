import type { GoogleDisplayImage } from "@sokosumi/core-client";
import { GoogleDisplayImageSchema } from "@sokosumi/core-client/schemas";

const image = GoogleDisplayImageSchema.properties;

export type DisplayImageRole = GoogleDisplayImage["role"];
export type DisplayImageMimeType = GoogleDisplayImage["mimeType"];

/** Where an image is added: the marketing images, or the logos. */
export type DisplayImageSlot = "images" | "logo";

/** Core's limits for one image, from its API schema. */
export const DISPLAY_IMAGE_MIME_TYPES = image.mimeType.enum;
export const DISPLAY_IMAGE_MAX_BYTES = image.size.maximum;

/**
 * What a Display ad's images must be. Core's schema states these only in
 * prose (the `role` description), so they are written here; Google stays the
 * authority and answers 422 for an image it refuses.
 */
export const DISPLAY_IMAGE_RULES = {
  landscape: { ratio: 1.91, minWidth: 600, minHeight: 314 },
  square: { ratio: 1, minWidth: 300, minHeight: 300 },
  logo: { ratio: 1, minWidth: 128, minHeight: 128 },
  /** How far from the exact ratio a picture may be, as a share of it. */
  ratioTolerance: 0.02,
  /** LANDSCAPE and SQUARE together. */
  maxMarketing: 6,
  maxLogos: 2,
} as const;

export const DISPLAY_IMAGE_MAX_KB = DISPLAY_IMAGE_MAX_BYTES / 1024;

const EXTENSION_MIME_TYPES: Record<string, DisplayImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

const isMimeType = (type: string): type is DisplayImageMimeType =>
  DISPLAY_IMAGE_MIME_TYPES.some((allowed) => allowed === type);

/** Why a file cannot be an ad image, found without reading its pixels. */
export type DisplayImageFileIssue = "type" | "tooLarge";

/**
 * The type and size checks, which need no pixels. A file without a type (a
 * Drive file) is read by its extension.
 */
export function checkDisplayImageFile(file: {
  name: string;
  type: string;
  size: number;
}):
  | { ok: true; mimeType: DisplayImageMimeType }
  | { ok: false; reason: DisplayImageFileIssue } {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = file.type
    ? isMimeType(file.type)
      ? file.type
      : undefined
    : EXTENSION_MIME_TYPES[extension];
  if (!mimeType) return { ok: false, reason: "type" };
  if (file.size > DISPLAY_IMAGE_MAX_BYTES) {
    return { ok: false, reason: "tooLarge" };
  }
  return { ok: true, mimeType };
}

/** Why a picture of this size cannot be used where it was added. */
export type DisplayImageSizeIssue =
  | "ratio"
  | "landscapeTooSmall"
  | "squareTooSmall"
  | "logoRatio"
  | "logoTooSmall";

const isNear = (value: number, target: number): boolean =>
  // The epsilon keeps an exact 2% (1.02 against 1) from failing on rounding.
  Math.abs(value / target - 1) <= DISPLAY_IMAGE_RULES.ratioTolerance + 1e-9;

/**
 * The role a picture of this size takes: in the images slot a ratio within 2%
 * of 1.91:1 is LANDSCAPE and within 2% of 1:1 is SQUARE; in the logo slot a
 * square is a LOGO. Anything else, or anything under the minimum size, is
 * refused with the reason.
 */
export function imageRoleForSize(
  width: number,
  height: number,
  slot: DisplayImageSlot,
):
  | { ok: true; role: DisplayImageRole }
  | { ok: false; reason: DisplayImageSizeIssue } {
  const ratio = width / height;
  const { landscape, square, logo } = DISPLAY_IMAGE_RULES;
  const big = (min: { minWidth: number; minHeight: number }) =>
    width >= min.minWidth && height >= min.minHeight;

  if (slot === "logo") {
    if (!isNear(ratio, logo.ratio)) return { ok: false, reason: "logoRatio" };
    return big(logo)
      ? { ok: true, role: "LOGO" }
      : { ok: false, reason: "logoTooSmall" };
  }
  if (isNear(ratio, landscape.ratio)) {
    return big(landscape)
      ? { ok: true, role: "LANDSCAPE" }
      : { ok: false, reason: "landscapeTooSmall" };
  }
  if (isNear(ratio, square.ratio)) {
    return big(square)
      ? { ok: true, role: "SQUARE" }
      : { ok: false, reason: "squareTooSmall" };
  }
  return { ok: false, reason: "ratio" };
}

/** How many images hold each role. */
export function displayImageCounts(images: readonly GoogleDisplayImage[]) {
  const count = (role: DisplayImageRole) =>
    images.filter((candidate) => candidate.role === role).length;
  const landscape = count("LANDSCAPE");
  const square = count("SQUARE");
  return {
    landscape,
    square,
    marketing: landscape + square,
    logo: count("LOGO"),
  };
}

/** What an ad still needs: Core wants a landscape and a square image. */
export function missingDisplayImages(
  images: readonly GoogleDisplayImage[],
): "both" | "landscape" | "square" | null {
  const { landscape, square } = displayImageCounts(images);
  if (landscape === 0 && square === 0) return "both";
  if (landscape === 0) return "landscape";
  if (square === 0) return "square";
  return null;
}

/** Whether another image of this role fits: 6 landscape and square together, 2 logos. */
export function hasRoomForDisplayImage(
  images: readonly GoogleDisplayImage[],
  role: DisplayImageRole,
): boolean {
  const { marketing, logo } = displayImageCounts(images);
  return role === "LOGO"
    ? logo < DISPLAY_IMAGE_RULES.maxLogos
    : marketing < DISPLAY_IMAGE_RULES.maxMarketing;
}

/** Why an image cannot join the others. */
export type DisplayImageAddIssue = "duplicate" | "full";

/** The images with this one added, or why it cannot be. */
export function addDisplayImage(
  images: readonly GoogleDisplayImage[],
  added: GoogleDisplayImage,
):
  | { ok: true; images: GoogleDisplayImage[] }
  | { ok: false; reason: DisplayImageAddIssue } {
  if (images.some(({ pathname }) => pathname === added.pathname)) {
    return { ok: false, reason: "duplicate" };
  }
  return hasRoomForDisplayImage(images, added.role)
    ? { ok: true, images: [...images, added] }
    : { ok: false, reason: "full" };
}
