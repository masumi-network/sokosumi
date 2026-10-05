import {
  buildEntityImagePathname,
  ENTITY_IMAGE_ALLOWED_MIME_TYPES,
  ENTITY_IMAGE_MAX_SIZE_BYTES,
  isEntityImageAllowedContentType,
  isOwnedEntityImageUrl,
} from "./entity-image-upload.js";

const COWORKER_IMAGES_DIR = "coworkers";

/** Allowed MIME types for coworker image uploads (server-enforced). */
export const COWORKER_IMAGE_ALLOWED_MIME_TYPES =
  ENTITY_IMAGE_ALLOWED_MIME_TYPES;

/** Max file size in bytes (2 MB) for coworker image uploads. */
export const COWORKER_IMAGE_MAX_SIZE_BYTES = ENTITY_IMAGE_MAX_SIZE_BYTES;

export function isCoworkerImageAllowedContentType(
  contentType: string,
): boolean {
  return isEntityImageAllowedContentType(contentType);
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `coworkers/{id}/image-ops.png`
 */
export function buildCoworkerImagePathname(
  coworkerId: string,
  filename: string,
  contentType: string,
): string {
  return buildEntityImagePathname(
    COWORKER_IMAGES_DIR,
    coworkerId,
    filename,
    contentType,
  );
}

/**
 * True when `url` is a public Vercel Blob URL under this coworker's
 * upload prefix (`/coworkers/{id}/…`).
 */
export function isOwnedCoworkerImageUrl(
  url: string,
  coworkerId: string,
): boolean {
  return isOwnedEntityImageUrl(url, COWORKER_IMAGES_DIR, coworkerId);
}
