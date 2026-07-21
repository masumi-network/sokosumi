import {
  buildEntityImagePathname,
  buildEntityImagePrefix,
  ENTITY_IMAGE_ALLOWED_MIME_TYPES,
  ENTITY_IMAGE_MAX_SIZE_BYTES,
  extensionForEntityImageMime,
  isEntityImageAllowedContentType,
  isOwnedEntityImageUrl,
} from "./entity-image-upload.js";

const ORCHESTRATOR_IMAGES_DIR = "orchestrators";

/** Allowed MIME types for orchestrator image uploads (server-enforced). */
export const ORCHESTRATOR_IMAGE_ALLOWED_MIME_TYPES =
  ENTITY_IMAGE_ALLOWED_MIME_TYPES;

/** Max file size in bytes (2 MB) for orchestrator image uploads. */
export const ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES = ENTITY_IMAGE_MAX_SIZE_BYTES;

export function isOrchestratorImageAllowedContentType(
  contentType: string,
): boolean {
  return isEntityImageAllowedContentType(contentType);
}

export function buildOrchestratorImagePrefix(orchestratorId: string): string {
  return buildEntityImagePrefix(ORCHESTRATOR_IMAGES_DIR, orchestratorId);
}

/** File extension for an allowed orchestrator image MIME type. */
export function extensionForOrchestratorImageMime(
  contentType: string,
): string | null {
  return extensionForEntityImageMime(contentType);
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `orchestrators/{id}/image-hermes.png`
 */
export function buildOrchestratorImagePathname(
  orchestratorId: string,
  filename: string,
  contentType: string,
): string {
  return buildEntityImagePathname(
    ORCHESTRATOR_IMAGES_DIR,
    orchestratorId,
    filename,
    contentType,
  );
}

/**
 * True when `url` is a public Vercel Blob URL under this orchestrator's
 * upload prefix (`/orchestrators/{id}/…`).
 */
export function isOwnedOrchestratorImageUrl(
  url: string,
  orchestratorId: string,
): boolean {
  return isOwnedEntityImageUrl(url, ORCHESTRATOR_IMAGES_DIR, orchestratorId);
}
