import {
  buildEntityImagePathname,
  buildEntityImagePrefix,
  ENTITY_IMAGE_ALLOWED_MIME_TYPES,
  ENTITY_IMAGE_MAX_SIZE_BYTES,
  extensionForEntityImageMime,
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

export function buildCoworkerImagePrefix(coworkerId: string): string {
  return buildEntityImagePrefix(COWORKER_IMAGES_DIR, coworkerId);
}

/** File extension for an allowed coworker image MIME type. */
export function extensionForCoworkerImageMime(
  contentType: string,
): string | null {
  return extensionForEntityImageMime(contentType);
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
