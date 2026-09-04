export const SOKO_BOT_AVATAR_BLOB_DIR = "soko-bots/avatars";
export const SOKO_BOT_AVATAR_LEGACY_BLOB_DIR = "soko-bot-avatars";
export const SOKO_BOT_AVATAR_BLOB_SQL_FROM = `/${SOKO_BOT_AVATAR_LEGACY_BLOB_DIR}/`;
export const SOKO_BOT_AVATAR_BLOB_SQL_TO = `/${SOKO_BOT_AVATAR_BLOB_DIR}/`;

export function buildSokoBotAvatarBlobPathname(
  key: string,
  sha256Hex: string,
): string {
  return `${SOKO_BOT_AVATAR_BLOB_DIR}/${key}-${sha256Hex.slice(0, 12)}.png`;
}

export function rewriteLegacySokoBotAvatarBlobPath(
  pathnameOrUrl: string,
): string {
  return pathnameOrUrl.replaceAll(
    `${SOKO_BOT_AVATAR_LEGACY_BLOB_DIR}/`,
    `${SOKO_BOT_AVATAR_BLOB_DIR}/`,
  );
}
