import { isVercelBlobPublicHost } from "./entity-image-upload.js";
import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const VENDOR_LOGOS_DIR = "vendors";
const LOGOS_SEGMENT = "logos";

/**
 * Prefix for vendor logo blobs.
 * Example: `vendors/{vendorId}/logos/`
 */
export function buildVendorLogoPrefix(vendorId: string): string {
  return `${VENDOR_LOGOS_DIR}/${vendorId}/${LOGOS_SEGMENT}/`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `vendors/{vendorId}/logos/Ops_Logo_1.png`
 */
export function buildVendorLogoPathname(
  vendorId: string,
  fileName: string,
): string {
  return `${buildVendorLogoPrefix(vendorId)}${sanitizeUserUploadFilename(fileName)}`;
}

/**
 * Content-hash pathname for server-side scrape puts (no random suffix).
 * Example: `vendors/{vendorId}/logos/{sha256Hex}`
 */
export function buildVendorLogoContentHashPathname(
  vendorId: string,
  sha256Hex: string,
): string {
  return `${buildVendorLogoPrefix(vendorId)}${sha256Hex}`;
}

/**
 * True when `url` is a public Vercel Blob URL under this vendor's
 * logos prefix (`/vendors/{vendorId}/logos/…`). Requires HTTPS and a
 * Vercel public blob host so foreign hosts cannot spoof ownership.
 */
export function isOwnedVendorLogoUrl(url: string, vendorId: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (!isVercelBlobPublicHost(parsed.hostname)) {
      return false;
    }
    const pathname = decodeURIComponent(parsed.pathname);
    const prefix = `/${buildVendorLogoPrefix(vendorId)}`;
    return pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
