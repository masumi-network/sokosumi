export const SOKO_BOT_AVATAR_BLOB_DIR = "soko-bots/avatars";
export const SOKO_BOT_AVATAR_LEGACY_BLOB_DIR = "soko-bot-avatars";
/**
 * Original-style avatars the top-up draws, as WebP under their own prefix.
 * Avatars drawn before that stay as `.png` directly under `soko-bots/avatars/`.
 */
export const SOKO_BOT_AVATAR_ORIGINAL_BLOB_DIR = `${SOKO_BOT_AVATAR_BLOB_DIR}/original`;

export function buildOriginalSokoBotAvatarBlobPathname(
  key: string,
  sha256Hex: string,
): string {
  return `${SOKO_BOT_AVATAR_ORIGINAL_BLOB_DIR}/${key}-${sha256Hex.slice(0, 12)}.webp`;
}

export function rewriteLegacySokoBotAvatarBlobPath(
  pathnameOrUrl: string,
): string {
  return pathnameOrUrl.replaceAll(
    `${SOKO_BOT_AVATAR_LEGACY_BLOB_DIR}/`,
    `${SOKO_BOT_AVATAR_BLOB_DIR}/`,
  );
}
