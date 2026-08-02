import { isVercelBlobPublicHost } from "./entity-image-upload.js";

/**
 * Blob path prefix for DESIGN.md URLs under Vercel Blob.
 * Matches the `design-md/` root used by `design-md-path` builders.
 */
export const DESIGN_MD_BLOB_PATH_PREFIX = "/design-md/";

/**
 * True when `url` is an HTTPS public Vercel Blob URL under `/design-md/…`.
 * Matches both legacy flat paths (`/design-md/{hash}.md`) and owner-scoped
 * nested paths (`/design-md/users/…`, `/design-md/organizations/…`).
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
