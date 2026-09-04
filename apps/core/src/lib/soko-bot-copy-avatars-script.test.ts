import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(
  join(coreRoot, "scripts/copy-soko-bot-avatars.mts"),
  "utf8",
);

describe("Soko Bot avatar copy script safety", () => {
  it("exposes copy and delete flags and defaults to dry-run", () => {
    expect(source).toContain("--copy");
    expect(source).toContain("--delete-legacy");
    expect(source).toContain("--confirm-delete-legacy");
    expect(source).toContain(
      "--copy and --delete-legacy cannot be used together",
    );
  });

  it("requires explicit confirmation before deleting the legacy prefix", () => {
    expect(source).toContain(
      "--delete-legacy requires --confirm-delete-legacy",
    );
  });

  it("imports prefix constants from the helper instead of spelling them a third time", () => {
    expect(source).toContain("soko-bot-avatar-blob-path");
    expect(source).toContain("SOKO_BOT_AVATAR_BLOB_DIR");
    expect(source).toContain("SOKO_BOT_AVATAR_LEGACY_BLOB_DIR");
    expect(source).toContain("rewriteLegacySokoBotAvatarBlobPath");
    expect(source).not.toMatch(/["']soko-bot-avatars/);
    expect(source).not.toMatch(/["']soko-bots\/avatars/);
  });

  it("sets image/png on copy because the Blob SDK does not keep source metadata", () => {
    expect(source).toContain('contentType: "image/png"');
  });
});
