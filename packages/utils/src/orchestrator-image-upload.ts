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
 */
export function buildOrchestratorImagePathname(
  orchestratorId: string,
  filename: string,
): string {
  const sanitized = sanitizeOrchestratorImageFilename(filename);
  return `${buildOrchestratorImagePrefix(orchestratorId)}image-${sanitized}`;
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

function sanitizeOrchestratorImageFilename(fileName: string): string {
  const sanitized = fileName
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/_+/g, "_")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");

  return sanitized.length > 0 ? sanitized : "image";
}
