import {
  buildEntityImagePathname,
  isEntityImageAllowedContentType,
  isOwnedEntityImageUrl,
} from "./entity-image-upload.js";

const SOCIAL_AVATARS_DIR = "social-avatars";

/** Max bytes Core downloads for one connected account's profile picture. */
export const SOCIAL_ACCOUNT_AVATAR_MAX_SIZE_BYTES = 2 * 1024 * 1024;

/** Raster image types only; SVG is excluded on purpose. */
export function isSocialAccountAvatarAllowedContentType(
  contentType: string,
): boolean {
  return isEntityImageAllowedContentType(contentType);
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `social-avatars/{projectId}/image-x-123.jpg`
 */
export function buildSocialAccountAvatarPathname(
  projectId: string,
  provider: string,
  externalAccountId: string,
  contentType: string,
): string {
  return buildEntityImagePathname(
    SOCIAL_AVATARS_DIR,
    projectId,
    `${provider}-${externalAccountId}`,
    contentType,
  );
}

/** True when `url` is a public Vercel Blob avatar stored for this Project. */
export function isOwnedSocialAccountAvatarUrl(
  url: string,
  projectId: string,
): boolean {
  return isOwnedEntityImageUrl(url, SOCIAL_AVATARS_DIR, projectId);
}
