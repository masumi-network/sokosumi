/**
 * Delete what the crafted avatar style left in Blob (ADR 0064): its `.webp`
 * stills and `.mp4` loops directly under `soko-bots/avatars/`, and the vendored
 * ffmpeg copy. Never a `.png` or anything under `soko-bots/avatars/original/`.
 * Run once per store, after the crafted rows are gone from that network's
 * database. Dry-run is default and prints what it would delete.
 *
 * BLOB_READ_WRITE_TOKEN=... pnpm --filter @sokosumi/core soko-bot:delete-crafted-avatar-blobs
 * BLOB_READ_WRITE_TOKEN=... pnpm --filter @sokosumi/core soko-bot:delete-crafted-avatar-blobs -- --apply
 */
import { del, list } from "@vercel/blob";

import {
  isCraftedSokoBotAvatarBlobPathname,
  SOKO_BOT_AVATAR_BLOB_DIR,
  SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR,
} from "../src/helpers/soko-bot-avatar-blob-path.js";

const args = process.argv.slice(2);
const unknownFlag = args.find((arg) => arg !== "--apply");
if (unknownFlag) throw new Error(`Unknown option: ${unknownFlag}`);
const apply = args.includes("--apply");

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required");

const urls: string[] = [];
for (const prefix of [
  `${SOKO_BOT_AVATAR_BLOB_DIR}/`,
  `${SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR}/`,
]) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (!isCraftedSokoBotAvatarBlobPathname(blob.pathname)) continue;
      urls.push(blob.url);
      console.log(blob.pathname);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

if (apply) {
  for (let i = 0; i < urls.length; i += 1000) {
    await del(urls.slice(i, i + 1000), { token });
  }
  console.log(`Deleted ${urls.length} crafted blobs`);
} else {
  console.log(`Would delete ${urls.length} crafted blobs (pass --apply)`);
}
