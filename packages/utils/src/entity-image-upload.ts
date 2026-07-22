import { sanitizeUserUploadFilename } from "./user-upload-path.js";

/** Allowed MIME types for entity image uploads (coworker, vendor, …). */
export const ENTITY_IMAGE_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** Max file size in bytes (2 MB) for entity image uploads. */
export const ENTITY_IMAGE_MAX_SIZE_BYTES = 2 * 1024 * 1024;

/** Public Vercel Blob host suffix (any store id under this domain). */
const VERCEL_BLOB_PUBLIC_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export function isEntityImageAllowedContentType(contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase();
  return (ENTITY_IMAGE_ALLOWED_MIME_TYPES as readonly string[]).includes(
    normalized,
  );
}

/** File extension for an allowed entity image MIME type. */
export function extensionForEntityImageMime(
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

export function buildEntityImagePrefix(
  directory: string,
  entityId: string,
): string {
  return `${directory}/${entityId}/`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `{directory}/{id}/image-ops.png`
 *
 * Filename sanitization reuses the linear-time user-upload sanitizer so we
 * do not introduce ReDoS-prone leading/trailing-dot regexes. The extension is
 * always taken from `contentType` so the pathname matches stored MIME.
 */
export function buildEntityImagePathname(
  directory: string,
  entityId: string,
  filename: string,
  contentType: string,
): string {
  const sanitized = sanitizeUserUploadFilename(filename);
  const baseName = sanitized.replace(/\.[^.]+$/, "") || "file";
  const extension = extensionForEntityImageMime(contentType) ?? "bin";
  return `${buildEntityImagePrefix(directory, entityId)}image-${baseName}.${extension}`;
}

export function isVercelBlobPublicHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "public.blob.vercel-storage.com" ||
    normalized.endsWith(VERCEL_BLOB_PUBLIC_HOST_SUFFIX)
  );
}

/**
 * True when `url` is a public Vercel Blob URL under
 * `/{directory}/{entityId}/…`. Requires HTTPS, a Vercel public blob host, and
 * the path prefix so foreign hosts cannot spoof ownership.
 */
export function isOwnedEntityImageUrl(
  url: string,
  directory: string,
  entityId: string,
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
    const prefix = `/${buildEntityImagePrefix(directory, entityId)}`;
    return pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
