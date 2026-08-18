import { isVercelBlobPublicHost } from "./entity-image-upload.js";

const PROJECTS_DIR = "projects";
const LOGOS_SEGMENT = "logos";

/** Prefix for project logo blobs: `projects/{projectId}/logos/`. */
export function buildProjectLogoPrefix(projectId: string): string {
  return `${PROJECTS_DIR}/${projectId}/${LOGOS_SEGMENT}/`;
}

/** Content-hash pathname for server-side scraped project logos. */
export function buildProjectLogoContentHashPathname(
  projectId: string,
  sha256Hex: string,
): string {
  return `${buildProjectLogoPrefix(projectId)}${sha256Hex}`;
}

/** True for an HTTPS public Vercel Blob URL owned by this project. */
export function isOwnedProjectLogoUrl(url: string, projectId: string): boolean {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !isVercelBlobPublicHost(parsed.hostname)
    ) {
      return false;
    }

    return decodeURIComponent(parsed.pathname).startsWith(
      `/${buildProjectLogoPrefix(projectId)}`,
    );
  } catch {
    return false;
  }
}

/** True for any structurally valid project-logo Vercel Blob URL. */
export function isProjectLogoBlobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (
      parsed.protocol !== "https:" ||
      !isVercelBlobPublicHost(parsed.hostname)
    ) {
      return false;
    }

    const pathname = decodeURIComponent(parsed.pathname);
    return /^\/projects\/[^/]+\/logos\/.+/.test(pathname);
  } catch {
    return false;
  }
}
