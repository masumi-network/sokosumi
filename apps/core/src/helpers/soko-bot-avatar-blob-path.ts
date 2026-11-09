export const SOKO_BOT_AVATAR_BLOB_DIR = "soko-bots/avatars";
export const SOKO_BOT_AVATAR_LEGACY_BLOB_DIR = "soko-bot-avatars";
/**
 * Original-style avatars the top-up draws. Their own prefix keeps them apart
 * from the crafted-style avatars' `.webp` files directly under
 * `soko-bots/avatars/`, which
 * `scripts/delete-crafted-style-soko-bot-avatar-blobs.mts` deletes.
 */
export const SOKO_BOT_AVATAR_ORIGINAL_BLOB_DIR = `${SOKO_BOT_AVATAR_BLOB_DIR}/original`;

export function buildOriginalSokoBotAvatarBlobPathname(
  key: string,
  sha256Hex: string,
): string {
  return `${SOKO_BOT_AVATAR_ORIGINAL_BLOB_DIR}/${key}-${sha256Hex.slice(0, 12)}.webp`;
}

/**
 * Where the crafted-style avatar pipeline kept its own ffmpeg build (ADR 0064
 * removed it).
 */
export const SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR = "vendor/ffmpeg-static";

/**
 * A blob crafted-style avatars left behind: a still (`.webp`) or loop
 * (`.mp4`) directly under `soko-bots/avatars/`, or the vendored ffmpeg copy
 * (`vendor/ffmpeg-static/<version>/ffmpeg-<build>.gz`).
 * Never a `.png` (original-style avatars) and never a subfolder such as
 * `soko-bots/avatars/original/`.
 * Exists only for `scripts/delete-crafted-style-soko-bot-avatar-blobs.mts`
 * (here so it can be unit-tested); delete it with that one-off script.
 */
export function isCraftedStyleAvatarBlobPathname(pathname: string): boolean {
  if (pathname.endsWith(".png")) return false;
  const ffmpegPrefix = `${SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR}/`;
  if (pathname.startsWith(ffmpegPrefix)) {
    return /^[^/]+\/ffmpeg-[^/]+\.gz$/.test(
      pathname.slice(ffmpegPrefix.length),
    );
  }
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
