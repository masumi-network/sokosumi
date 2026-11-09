import { describe, expect, it } from "vitest";

import {
  buildOriginalSokoBotAvatarBlobPathname,
  isCraftedStyleAvatarBlobPathname,
  rewriteLegacySokoBotAvatarBlobPath,
  SOKO_BOT_AVATAR_BLOB_DIR,
  SOKO_BOT_AVATAR_LEGACY_BLOB_DIR,
} from "./soko-bot-avatar-blob-path";

const SHA256_HEX = "abcdef0123456789deadbeef";
const HASH12 = "abcdef012345";
const KEY = "owl-1";

describe("soko-bot avatar blob path", () => {
  it("encodes an original-style avatar as soko-bots/avatars/original/{key}-{hash12}.webp", () => {
    expect(SOKO_BOT_AVATAR_BLOB_DIR).toBe("soko-bots/avatars");
    expect(SOKO_BOT_AVATAR_LEGACY_BLOB_DIR).toBe("soko-bot-avatars");
    expect(buildOriginalSokoBotAvatarBlobPathname(KEY, SHA256_HEX)).toBe(
      `soko-bots/avatars/original/${KEY}-${HASH12}.webp`,
    );
  });

  it("rewrites a legacy pathname and a full public URL onto the new prefix", () => {
    expect(
      rewriteLegacySokoBotAvatarBlobPath(
        `soko-bot-avatars/${KEY}-${HASH12}.png`,
      ),
    ).toBe(`soko-bots/avatars/${KEY}-${HASH12}.png`);
    expect(
      rewriteLegacySokoBotAvatarBlobPath(
        `https://public.blob.vercel-storage.com/soko-bot-avatars/${KEY}-${HASH12}.png`,
      ),
    ).toBe(
      `https://public.blob.vercel-storage.com/soko-bots/avatars/${KEY}-${HASH12}.png`,
    );
  });

  it("is identity on an already-new path and a second apply is a no-op", () => {
    const next = `soko-bots/avatars/${KEY}-${HASH12}.png`;
    expect(rewriteLegacySokoBotAvatarBlobPath(next)).toBe(next);
    expect(
      rewriteLegacySokoBotAvatarBlobPath(
        rewriteLegacySokoBotAvatarBlobPath(
          `soko-bot-avatars/${KEY}-${HASH12}.png`,
        ),
      ),
    ).toBe(next);
  });

  it("leaves unrelated and fal URLs unchanged", () => {
    expect(
      rewriteLegacySokoBotAvatarBlobPath("https://fal.media/files/owl.png"),
    ).toBe("https://fal.media/files/owl.png");
    expect(
      rewriteLegacySokoBotAvatarBlobPath(
        "soko-bots/11111111-1111-1111-1111-111111111111/chats/room/file.png",
      ),
    ).toBe(
      "soko-bots/11111111-1111-1111-1111-111111111111/chats/room/file.png",
    );
  });
});

describe("crafted-style avatar blob cleanup selection", () => {
  it("selects crafted-style avatar stills and loops directly under soko-bots/avatars/", () => {
    for (const pathname of [
      `soko-bots/avatars/owl-3-${HASH12}.webp`,
      `soko-bots/avatars/draft-0190a1b2-${HASH12}.webp`,
      `soko-bots/avatars/0190a1b2-idle-${HASH12}.webp`,
      `soko-bots/avatars/0190a1b2-working-loop-${HASH12}.mp4`,
      `soko-bots/avatars/0190a1b2-working-loop-large-${HASH12}.mp4`,
    ]) {
      expect(isCraftedStyleAvatarBlobPathname(pathname), pathname).toBe(true);
    }
  });

  it("selects the vendored ffmpeg copy", () => {
    expect(
      isCraftedStyleAvatarBlobPathname(
        "vendor/ffmpeg-static/b6.1.1/ffmpeg-linux-x64-Kat8TFEc5GgKu9hryOAPTb3VpUHuG9.gz",
      ),
    ).toBe(true);
  });

  it("never selects a .png, an original-style WebP, or anything else", () => {
    for (const pathname of [
      `soko-bots/avatars/round-helper-robot-3-${HASH12}.png`,
      `soko-bot-avatars/round-helper-robot-3-${HASH12}.png`,
      `soko-bots/avatars/original/owl-1-${HASH12}.webp`,
      `soko-bots/avatars/original/nested/owl-1-${HASH12}.webp`,
      `soko-bots/avatars/other/clip-${HASH12}.mp4`,
      `soko-bot-avatars/owl-${HASH12}.webp`,
      "soko-bots/11111111-1111-1111-1111-111111111111/chats/room/file.webp",
      "vendor/other/ffmpeg.gz",
      `vendor/ffmpeg-static/owl-${HASH12}.png`,
      `vendor/ffmpeg-static/b6.1.1/owl-${HASH12}.png`,
      "vendor/ffmpeg-static/b6.1.1/ffmpeg-linux-x64-Kat8TFEc5GgKu9hryOAPTb3VpUHuG9.gz.png",
      "vendor/ffmpeg-static/b6.1.1/readme.txt",
      "vendor/ffmpeg-static/b6.1.1/nested/ffmpeg-linux-x64.gz",
      "soko-bots/avatars/owl.webp.png",
    ]) {
      expect(isCraftedStyleAvatarBlobPathname(pathname), pathname).toBe(false);
    }
  });
});
