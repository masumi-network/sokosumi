/**
 * Delete what crafted-style avatars left in Blob (ADR 0064): their `.webp`
 * stills and `.mp4` loops directly under `soko-bots/avatars/`, and the vendored
 * ffmpeg copy. Never a `.png` or anything under `soko-bots/avatars/original/`.
 * Run once per store, after the crafted-style rows are gone from that network's
 * database. Dry-run is default and prints what it would delete.
 *
 * The token comes from `apps/core/.env` (`tsx --env-file=.env`); a
 * `BLOB_READ_WRITE_TOKEN` exported in the shell wins over the file. The store
 * id and the token's source print before anything is listed.
 *
 * pnpm --filter @sokosumi/core soko-bot:delete-crafted-style-avatar-blobs
 * pnpm --filter @sokosumi/core soko-bot:delete-crafted-style-avatar-blobs -- --apply --confirm-delete
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

import { del, list } from "@vercel/blob";

import {
  isCraftedStyleAvatarBlobPathname,
  SOKO_BOT_AVATAR_BLOB_DIR,
  SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR,
} from "../src/helpers/soko-bot-avatar-blob-path.js";

const args = process.argv.slice(2);
const supportedFlags = new Set(["--apply", "--confirm-delete"]);
const unknownFlag = args.find((arg) => !supportedFlags.has(arg));
if (unknownFlag) throw new Error(`Unknown option: ${unknownFlag}`);
const apply = args.includes("--apply");
const confirmDelete = args.includes("--confirm-delete");
if (apply && !confirmDelete) {
  throw new Error("--apply requires --confirm-delete");
}
if (!apply && confirmDelete) {
  throw new Error("--confirm-delete is only valid with --apply");
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required");

// Read-write tokens look like `vercel_blob_rw_<storeId>_<secret>`.
const storeId = /^vercel_blob_rw_([^_]+)_/.exec(token)?.[1];
if (!storeId) {
  throw new Error(
    "BLOB_READ_WRITE_TOKEN is not a Vercel Blob read-write token",
  );
}

let dotEnvToken: string | undefined;
try {
  dotEnvToken = parseEnv(readFileSync(".env", "utf8")).BLOB_READ_WRITE_TOKEN;
} catch {
  dotEnvToken = undefined;
}
const tokenSource =
  dotEnvToken === token ? `${process.cwd()}/.env` : "the shell environment";
console.log(`Blob store ${storeId} (token from ${tokenSource})`);

const urls: string[] = [];
for (const prefix of [
  `${SOKO_BOT_AVATAR_BLOB_DIR}/`,
  `${SOKO_BOT_AVATAR_FFMPEG_BLOB_DIR}/`,
]) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, token, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      if (!isCraftedStyleAvatarBlobPathname(blob.pathname)) continue;
      urls.push(blob.url);
      console.log(blob.pathname);
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}

if (apply) {
  let deleted = 0;
  try {
    for (let i = 0; i < urls.length; i += 1000) {
      const batch = urls.slice(i, i + 1000);
      await del(batch, { token });
      deleted += batch.length;
    }
  } catch (error) {
    console.error(
      `Deleted ${deleted} crafted-style blobs from store ${storeId}, then a batch failed; ${urls.length - deleted} remain. Rerun to retry.`,
    );
    console.error(error);
    process.exit(1);
  }
  console.log(`Deleted ${deleted} crafted-style blobs from store ${storeId}`);
} else {
  console.log(
    `Would delete ${urls.length} crafted-style blobs from store ${storeId} (pass --apply --confirm-delete)`,
  );
}
