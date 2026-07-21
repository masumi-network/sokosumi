import { sanitizeUserUploadFilename } from "./user-upload-path.js";

/** Allowed MIME types for orchestrator image uploads (server-enforced). */
export const ORCHESTRATOR_IMAGE_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Max file size in bytes (2 MB) for orchestrator image uploads. */
export const ORCHESTRATOR_IMAGE_MAX_SIZE_BYTES = 2 * 1024 * 1024;

const ORCHESTRATOR_IMAGES_DIR = "orchestrators";

export function isOrchestratorImageAllowedContentType(
  contentType: string,
): boolean {
  const normalized = contentType.trim().toLowerCase();
  return (ORCHESTRATOR_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(
    normalized,
  );
}

export function buildOrchestratorImagePrefix(orchestratorId: string): string {
  return `${ORCHESTRATOR_IMAGES_DIR}/${orchestratorId}/`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `orchestrators/{id}/image-hermes.png`
 *
 * Filename sanitization reuses the linear-time user-upload sanitizer so we
 * do not introduce ReDoS-prone leading/trailing-dot regexes.
 */
export function buildOrchestratorImagePathname(
  orchestratorId: string,
  filename: string,
): string {
  return `${buildOrchestratorImagePrefix(orchestratorId)}image-${sanitizeUserUploadFilename(filename)}`;
}

export function isOwnedOrchestratorImageUrl(
  url: string,
  orchestratorId: string,
): boolean {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    // Vercel Blob pathnames look like `/orchestrators/{id}/image-….png`.
    const prefix = `/${buildOrchestratorImagePrefix(orchestratorId)}`;
    return pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
