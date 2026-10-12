import type { GoogleDisplayImage } from "@sokosumi/core-client";
import { GoogleDisplayImageSchema } from "@sokosumi/core-client/schemas";

const image = GoogleDisplayImageSchema.properties;

export type DisplayImageRole = GoogleDisplayImage["role"];
type DisplayImageMimeType = GoogleDisplayImage["mimeType"];

/** Where an image is added: the marketing images, or the logos. */
export type DisplayImageSlot = "images" | "logo";

/** Core's limits for one image, from its API schema. */
export const DISPLAY_IMAGE_ROLES = image.role.enum;
export const DISPLAY_IMAGE_MIME_TYPES = image.mimeType.enum;
export const DISPLAY_IMAGE_MAX_BYTES = image.size.maximum;
export const DISPLAY_IMAGE_MAX_MB = DISPLAY_IMAGE_MAX_BYTES / 1024 / 1024;

/** The smallest a picture may be, in pixels. */
export interface MinSize {
  minWidth: number;
  minHeight: number;
}

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
  ratioTolerance: 0.01,
  /** LANDSCAPE and SQUARE together. */
  maxMarketing: 6,
  maxLogos: 2,
} as const;

/** Which slot holds each role, and how many a slot takes. */
const SLOT_OF_ROLE: Record<DisplayImageRole, DisplayImageSlot> = {
  LANDSCAPE: "images",
  SQUARE: "images",
  LOGO: "logo",
};
const SLOT_MAX: Record<DisplayImageSlot, number> = {
  images: DISPLAY_IMAGE_RULES.maxMarketing,
  logo: DISPLAY_IMAGE_RULES.maxLogos,
};

/** The images that sit in this slot. */
export function imagesInSlot(
  images: readonly GoogleDisplayImage[],
  slot: DisplayImageSlot,
): GoogleDisplayImage[] {
  return images.filter(({ role }) => SLOT_OF_ROLE[role] === slot);
}

const EXTENSION_MIME_TYPES: Record<string, DisplayImageMimeType> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
};

function isMimeType(type: string): type is DisplayImageMimeType {
  return DISPLAY_IMAGE_MIME_TYPES.some((allowed) => allowed === type);
}

/** Why a file cannot be an ad image, found without reading its pixels. */
type DisplayImageFileIssue = "type" | "tooLarge";

type DisplayImageFileCheck =
  | { ok: true; mimeType: DisplayImageMimeType }
  | { ok: false; reason: DisplayImageFileIssue };

function checkMimeTypeAndSize(
  mimeType: DisplayImageMimeType | undefined,
  size: number,
): DisplayImageFileCheck {
  if (!mimeType) return { ok: false, reason: "type" };
  if (size > DISPLAY_IMAGE_MAX_BYTES) {
    return { ok: false, reason: "tooLarge" };
  }
  return { ok: true, mimeType };
}

/** The type and size checks for a file the browser has typed, which need no pixels. */
export function checkDisplayImageFile(file: {
  type: string;
  size: number;
}): DisplayImageFileCheck {
  return checkMimeTypeAndSize(
    isMimeType(file.type) ? file.type : undefined,
    file.size,
  );
}

/** The same checks for a Drive file, which has no type: its extension tells. */
export function checkDisplayImageFileByName(file: {
  name: string;
  size: number;
}): DisplayImageFileCheck {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return checkMimeTypeAndSize(EXTENSION_MIME_TYPES[extension], file.size);
}

/** Why a picture of this size cannot be used where it was added. */
export type DisplayImageSizeIssue =
  | "ratio"
  | "landscapeTooSmall"
  | "squareTooSmall"
  | "logoRatio"
  | "logoTooSmall";

function isNear(value: number, target: number): boolean {
  // The epsilon keeps an exact 1% (1.01 against 1) from failing on rounding.
  return (
    Math.abs(value / target - 1) <= DISPLAY_IMAGE_RULES.ratioTolerance + 1e-9
  );
}

/**
 * The role a picture of this size takes: in the images slot a ratio within 1%
 * of 1.91:1 is LANDSCAPE and within 1% of 1:1 is SQUARE; in the logo slot a
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
  function big(min: MinSize): boolean {
    return width >= min.minWidth && height >= min.minHeight;
  }

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
  function count(role: DisplayImageRole): number {
    return images.filter((candidate) => candidate.role === role).length;
  }
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
  const slot = SLOT_OF_ROLE[role];
  return imagesInSlot(images, slot).length < SLOT_MAX[slot];
}

/** Why an image cannot join the others. */
type DisplayImageAddIssue = "duplicate" | "full";

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
