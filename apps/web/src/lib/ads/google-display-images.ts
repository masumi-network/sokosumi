import type { GoogleDisplayImage } from "@sokosumi/core-client";
import { GoogleDisplayImageSchema } from "@sokosumi/core-client/schemas";
import { err, ok, type Result } from "neverthrow";

const image = GoogleDisplayImageSchema.properties;

export type DisplayImageRole = GoogleDisplayImage["role"];
type DisplayImageMimeType = GoogleDisplayImage["mimeType"];

/**
 * An image the ad being edited already has, kept as it is. Core takes only its
 * `assetId` and `role`; `url` is Google's, to show it.
 */
export interface KeptDisplayImage {
  assetId: string;
  role: DisplayImageRole;
  url: string;
}

/** What the form holds as an image: a Drive file to upload, or a kept one. */
export type FormDisplayImage = GoogleDisplayImage | KeptDisplayImage;

export function isKeptImage(
  image: FormDisplayImage,
): image is KeptDisplayImage {
  return "assetId" in image;
}

/**
 * The Drive files among the form's images, for a create. A new campaign has
 * no kept images, so one here is a bug: it is refused, never dropped.
 */
export function driveImagesOnly(
  images: readonly FormDisplayImage[],
): GoogleDisplayImage[] {
  return images.map((image) => {
    if (isKeptImage(image)) {
      throw new Error("A new campaign has no kept images");
    }
    return image;
  });
}

/** What tells one image from another: a kept one's asset, a Drive file's path. */
export function displayImageKey(
  image: { assetId: string } | { pathname: string },
): string {
  return "assetId" in image ? `asset:${image.assetId}` : image.pathname;
}

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
export function imagesInSlot<T extends { role: DisplayImageRole }>(
  images: readonly T[],
  slot: DisplayImageSlot,
): T[] {
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

function checkMimeTypeAndSize(
  mimeType: DisplayImageMimeType | undefined,
  size: number,
): Result<DisplayImageMimeType, DisplayImageFileIssue> {
  if (!mimeType) return err("type");
  if (size > DISPLAY_IMAGE_MAX_BYTES) {
    return err("tooLarge");
  }
  return ok(mimeType);
}

/** The type and size checks for a file the browser has typed, which need no pixels. */
export function checkDisplayImageFile(file: {
  type: string;
  size: number;
}): Result<DisplayImageMimeType, DisplayImageFileIssue> {
  return checkMimeTypeAndSize(
    isMimeType(file.type) ? file.type : undefined,
    file.size,
  );
}

/** The same checks for a Drive file, which has no type: its extension tells. */
export function checkDisplayImageFileByName(file: {
  name: string;
  size: number;
}): Result<DisplayImageMimeType, DisplayImageFileIssue> {
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
): Result<DisplayImageRole, DisplayImageSizeIssue> {
  const ratio = width / height;
  const { landscape, square, logo } = DISPLAY_IMAGE_RULES;
  function big(min: MinSize): boolean {
    return width >= min.minWidth && height >= min.minHeight;
  }

  if (slot === "logo") {
    if (!isNear(ratio, logo.ratio)) return err("logoRatio");
    return big(logo) ? ok("LOGO") : err("logoTooSmall");
  }
  if (isNear(ratio, landscape.ratio)) {
    return big(landscape) ? ok("LANDSCAPE") : err("landscapeTooSmall");
  }
  if (isNear(ratio, square.ratio)) {
    return big(square) ? ok("SQUARE") : err("squareTooSmall");
  }
  return err("ratio");
}

/** How many images hold each role. */
export function displayImageCounts(
  images: readonly { role: DisplayImageRole }[],
) {
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
  images: readonly { role: DisplayImageRole }[],
): "both" | "landscape" | "square" | null {
  const { landscape, square } = displayImageCounts(images);
  if (landscape === 0 && square === 0) return "both";
  if (landscape === 0) return "landscape";
  if (square === 0) return "square";
  return null;
}

/** Whether another image of this role fits: 6 landscape and square together, 2 logos. */
export function hasRoomForDisplayImage(
  images: readonly { role: DisplayImageRole }[],
  role: DisplayImageRole,
): boolean {
  const slot = SLOT_OF_ROLE[role];
  return imagesInSlot(images, slot).length < SLOT_MAX[slot];
}

/** Why an image cannot join the others. */
type DisplayImageAddIssue = "duplicate" | "full";

/** The images with this one added, or why it cannot be. */
export function addDisplayImage(
  images: readonly FormDisplayImage[],
  added: FormDisplayImage,
): Result<FormDisplayImage[], DisplayImageAddIssue> {
  if (
    images.some((image) => displayImageKey(image) === displayImageKey(added))
  ) {
    return err("duplicate");
  }
  return hasRoomForDisplayImage(images, added.role)
    ? ok([...images, added])
    : err("full");
}
