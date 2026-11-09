export const SOKO_BOT_AVATAR_BLOB_DIR = "soko-bots/avatars";
export const SOKO_BOT_AVATAR_LEGACY_BLOB_DIR = "soko-bot-avatars";
/**
 * Original-style avatars the top-up draws. Their own prefix keeps them apart
 * from the crafted `.webp` files directly under `soko-bots/avatars/`, which
 * `scripts/delete-crafted-soko-bot-avatar-blobs.mts` deletes.
 */
export const SOKO_BOT_AVATAR_ORIGINAL_BLOB_DIR = `${SOKO_BOT_AVATAR_BLOB_DIR}/original`;

export function buildOriginalSokoBotAvatarBlobPathname(
  key: string,
  sha256Hex: string,
): string {
  return `${SOKO_BOT_AVATAR_ORIGINAL_BLOB_DIR}/${key}-${sha256Hex.slice(0, 12)}.webp`;
}

/** Where the crafted pipeline kept its own ffmpeg build (ADR 0064 removed it). */
export const SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR = "vendor/ffmpeg-static";

/**
 * A blob the crafted style left behind: a still (`.webp`) or loop (`.mp4`)
 * directly under `soko-bots/avatars/`, or the vendored ffmpeg copy.
 * Never a `.png` (original-style avatars) and never a subfolder such as
 * `soko-bots/avatars/original/`.
 */
export function isCraftedSokoBotAvatarBlobPathname(pathname: string): boolean {
  if (pathname.startsWith(`${SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR}/`)) return true;
  const prefix = `${SOKO_BOT_AVATAR_BLOB_DIR}/`;
  if (!pathname.startsWith(prefix)) return false;
  const name = pathname.slice(prefix.length);
  return !name.includes("/") && /\.(webp|mp4)$/.test(name);
}

export function rewriteLegacySokoBotAvatarBlobPath(
  pathnameOrUrl: string,
): string {
  return pathnameOrUrl.replaceAll(
    `${SOKO_BOT_AVATAR_LEGACY_BLOB_DIR}/`,
    `${SOKO_BOT_AVATAR_BLOB_DIR}/`,
  );
}
