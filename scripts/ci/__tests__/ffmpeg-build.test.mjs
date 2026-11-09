import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

async function readRepoFile(...segments) {
  return readFile(path.join(repoRoot, ...segments), "utf8");
}

describe("ffmpeg build", () => {
  it("CI's Setup fetches the build Core runs, with the same hash", async () => {
    const media = await readRepoFile(
      "apps",
      "core",
      "src",
      "lib",
      "soko-bot-avatar",
      "media.ts",
    );
    const url = media.match(/DEFAULT_FFMPEG_BUILD = \{\s*url: "([^"]+)"/)?.[1];
    const sha256 = media.match(/sha256: "([0-9a-f]{64})"/)?.[1];
    assert.ok(url && sha256, "DEFAULT_FFMPEG_BUILD has a url and sha256");

    const setup = await readRepoFile(
      ".github",
      "actions",
      "setup",
      "action.yml",
    );
    assert.match(
      setup,
      new RegExp(`FFMPEG_URL: ${url.replaceAll(".", "\\.")}\\n`),
    );
    assert.match(setup, new RegExp(`FFMPEG_SHA256: ${sha256}\\n`));
  });

  it("Core's Vercel install skips the GitHub download", async () => {
    // Core fetches the Blob copy when it runs; GitHub Releases failing
    // (2026-11-09) otherwise failed every Core deploy in pnpm install.
    const vercel = JSON.parse(
      await readRepoFile("apps", "core", "vercel.json"),
    );
    assert.match(vercel.installCommand, /^FFMPEG_BIN=\/bin\/sh pnpm install /);
  });

  it("only Test Core asks Setup for ffmpeg", async () => {
    const ci = await readRepoFile(".github", "workflows", "ci.yml");
    assert.equal(ci.match(/ffmpeg: "true"/g)?.length, 1);
    const core = ci.slice(
      ci.indexOf("name: Test Core"),
      ci.indexOf("name: Test Packages"),
    );
    assert.match(core, /ffmpeg: "true"/);
  });
});
