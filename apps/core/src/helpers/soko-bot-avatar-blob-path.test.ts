import { describe, expect, it } from "vitest";

import {
  buildSokoBotAvatarBlobPathname,
  rewriteLegacySokoBotAvatarBlobPath,
  SOKO_BOT_AVATAR_BLOB_DIR,
  SOKO_BOT_AVATAR_BLOB_SQL_FROM,
  SOKO_BOT_AVATAR_BLOB_SQL_TO,
  SOKO_BOT_AVATAR_LEGACY_BLOB_DIR,
} from "./soko-bot-avatar-blob-path";

const SHA256_HEX = "abcdef0123456789deadbeef";
const HASH12 = "abcdef012345";
const KEY = "owl-1";

describe("soko-bot avatar blob path", () => {
  it("encodes the new pool pathname as soko-bots/avatars/{key}-{hash12}.png", () => {
    expect(SOKO_BOT_AVATAR_BLOB_DIR).toBe("soko-bots/avatars");
    expect(SOKO_BOT_AVATAR_LEGACY_BLOB_DIR).toBe("soko-bot-avatars");
    expect(SOKO_BOT_AVATAR_BLOB_SQL_FROM).toBe("/soko-bot-avatars/");
    expect(SOKO_BOT_AVATAR_BLOB_SQL_TO).toBe("/soko-bots/avatars/");
    expect(buildSokoBotAvatarBlobPathname(KEY, SHA256_HEX)).toBe(
      `soko-bots/avatars/${KEY}-${HASH12}.png`,
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
