import { sanitizeUserUploadFilename } from "./user-upload-path.js";

/** Allowed MIME types for coworker image uploads (server-enforced). */
export const COWORKER_IMAGE_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Max file size in bytes (2 MB) for coworker image uploads. */
export const COWORKER_IMAGE_MAX_SIZE_BYTES = 2 * 1024 * 1024;

const COWORKER_IMAGES_DIR = "coworkers";

/** Public Vercel Blob host suffix (any store id under this domain). */
const VERCEL_BLOB_PUBLIC_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function isCoworkerImageAllowedContentType(
  contentType: string,
): boolean {
  const normalized = contentType.trim().toLowerCase();
  return (COWORKER_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(
    normalized,
  );
}

export function buildCoworkerImagePrefix(coworkerId: string): string {
  return `${COWORKER_IMAGES_DIR}/${coworkerId}/`;
}

/** File extension for an allowed coworker image MIME type. */
export function extensionForCoworkerImageMime(
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
 * Example: `coworkers/{id}/image-ops.png`
 *
 * Filename sanitization reuses the linear-time user-upload sanitizer so we
 * do not introduce ReDoS-prone leading/trailing-dot regexes. The extension is
 * always taken from `contentType` so the pathname matches stored MIME.
 */
export function buildCoworkerImagePathname(
  coworkerId: string,
  filename: string,
  contentType: string,
): string {
  const sanitized = sanitizeUserUploadFilename(filename);
  const baseName = sanitized.replace(/\.[^.]+$/, "") || "file";
  const extension = extensionForCoworkerImageMime(contentType) ?? "bin";
  return `${buildCoworkerImagePrefix(coworkerId)}image-${baseName}.${extension}`;
}

function isVercelBlobPublicHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "public.blob.vercel-storage.com" ||
    normalized.endsWith(VERCEL_BLOB_PUBLIC_HOST_SUFFIX)
  );
}

/**
 * True when `url` is a public Vercel Blob URL under this coworker's
 * upload prefix (`/coworkers/{id}/…`). Requires HTTPS, a Vercel public
 * blob host, and the path prefix so foreign hosts cannot spoof ownership.
 */
export function isOwnedCoworkerImageUrl(
  url: string,
  coworkerId: string,
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (!isVercelBlobPublicHost(parsed.hostname)) {
      return false;
    }
    const pathname = decodeURIComponent(parsed.pathname);
    const prefix = `/${buildCoworkerImagePrefix(coworkerId)}`;
    return pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
