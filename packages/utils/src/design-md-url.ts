import { isVercelBlobPublicHost } from "./entity-image-upload.js";

/**
 * Blob path prefix used by Core when uploading DESIGN.md content
 * (`STORAGE.DESIGN_MD_UPLOAD_DIR` in apps/core).
 */
export const DESIGN_MD_BLOB_PATH_PREFIX = "/design-md/";

/**
 * True when `url` is an HTTPS public Vercel Blob URL under `/design-md/…`.
 * Used to stop SSRF via attacker-controlled `metadata.designMdUrl` values —
 * only Core-uploaded DESIGN.md blobs match this shape.
 */
export function isDesignMdBlobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (!isVercelBlobPublicHost(parsed.hostname)) {
      return false;
    }
    const pathname = decodeURIComponent(parsed.pathname);
    return pathname.startsWith(DESIGN_MD_BLOB_PATH_PREFIX);
  } catch {
    return false;
  }
}
