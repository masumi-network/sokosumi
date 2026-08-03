import { isVercelBlobPublicHost } from "./entity-image-upload.js";
import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const ORGANIZATION_LOGOS_DIR = "organizations";
const LOGOS_SEGMENT = "logos";

/**
 * Prefix for organization logo blobs.
 * Example: `organizations/{orgId}/logos/`
 */
export function buildOrganizationLogoPrefix(organizationId: string): string {
  return `${ORGANIZATION_LOGOS_DIR}/${organizationId}/${LOGOS_SEGMENT}/`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `organizations/{orgId}/logos/Ops_Logo_1.png`
 */
export function buildOrganizationLogoPathname(
  organizationId: string,
  fileName: string,
): string {
  return `${buildOrganizationLogoPrefix(organizationId)}${sanitizeUserUploadFilename(fileName)}`;
}

/**
 * Content-hash pathname for server-side scrape puts (no random suffix).
 * Example: `organizations/{orgId}/logos/{sha256Hex}`
 */
export function buildOrganizationLogoContentHashPathname(
  organizationId: string,
  sha256Hex: string,
): string {
  return `${buildOrganizationLogoPrefix(organizationId)}${sha256Hex}`;
}

/**
 * True when `url` is a public Vercel Blob URL under this organization's
 * logos prefix (`/organizations/{orgId}/logos/…`). Requires HTTPS and a
 * Vercel public blob host so foreign hosts cannot spoof ownership.
 */
export function isOwnedOrganizationLogoUrl(
  url: string,
  organizationId: string,
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
    const prefix = `/${buildOrganizationLogoPrefix(organizationId)}`;
    return pathname.startsWith(prefix);
  } catch {
    return false;
  }
}
