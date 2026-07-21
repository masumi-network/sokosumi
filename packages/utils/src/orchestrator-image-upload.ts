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

/** Public Vercel Blob host suffix (any store id under this domain). */
const VERCEL_BLOB_PUBLIC_HOST_SUFFIX = ".public.blob.vercel-storage.com";

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

/** File extension for an allowed orchestrator image MIME type. */
export function extensionForOrchestratorImageMime(
  contentType: string,
): string | null {
  switch (contentType.trim().toLowerCase()) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return null;
  }
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `orchestrators/{id}/image-hermes.png`
 *
 * Filename sanitization reuses the linear-time user-upload sanitizer so we
 * do not introduce ReDoS-prone leading/trailing-dot regexes. The extension is
 * always taken from `contentType` so the pathname matches stored MIME.
 */
export function buildOrchestratorImagePathname(
  orchestratorId: string,
  filename: string,
  contentType: string,
): string {
  const sanitized = sanitizeUserUploadFilename(filename);
  const baseName = sanitized.replace(/\.[^.]+$/, "") || "file";
  const extension = extensionForOrchestratorImageMime(contentType) ?? "bin";
  return `${buildOrchestratorImagePrefix(orchestratorId)}image-${baseName}.${extension}`;
}

function isVercelBlobPublicHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "public.blob.vercel-storage.com" ||
    normalized.endsWith(VERCEL_BLOB_PUBLIC_HOST_SUFFIX)
  );
}

/**
 * True when `url` is a public Vercel Blob URL under this orchestrator's
 * upload prefix (`/orchestrators/{id}/…`). Requires HTTPS, a Vercel public
 * blob host, and the path prefix so foreign hosts cannot spoof ownership.
 */
export function isOwnedOrchestratorImageUrl(
  url: string,
  orchestratorId: string,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (!isVercelBlobPublicHost(parsed.hostname)) {
      return false;
    }
    // Vercel Blob pathnames look like `/orchestrators/{id}/image-….png`.
    const pathname = decodeURIComponent(parsed.pathname);
    const prefix = `/${buildOrchestratorImagePrefix(orchestratorId)}`;
    return pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
