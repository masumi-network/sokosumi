/**
 * Copy the mascot pool to the nested Blob prefix, or delete the legacy prefix.
 * Dry-run is default. Copy and delete are separate invocations.
 *
 * pnpm --filter @sokosumi/core soko-bot:copy-avatars
 * pnpm --filter @sokosumi/core soko-bot:copy-avatars -- --copy
 * pnpm --filter @sokosumi/core soko-bot:copy-avatars -- --delete-legacy --confirm-delete-legacy
 */
import { copy, del, list } from "@vercel/blob";

import {
  rewriteLegacySokoBotAvatarBlobPath,
  SOKO_BOT_AVATAR_BLOB_DIR,
  SOKO_BOT_AVATAR_LEGACY_BLOB_DIR,
} from "../src/helpers/soko-bot-avatar-blob-path.js";

interface ListedBlob {
  url: string;
  pathname: string;
}

const args = process.argv.slice(2);
const supportedFlags = new Set([
  "--copy",
  "--delete-legacy",
  "--confirm-delete-legacy",
]);
const unknownFlag = args.find(
  (arg) => arg.startsWith("--") && !supportedFlags.has(arg),
);
if (unknownFlag) throw new Error(`Unknown option: ${unknownFlag}`);

const copyMode = args.includes("--copy");
const deleteLegacy = args.includes("--delete-legacy");
const confirmDeleteLegacy = args.includes("--confirm-delete-legacy");
if (copyMode && deleteLegacy) {
  throw new Error("--copy and --delete-legacy cannot be used together");
}
if (deleteLegacy && !confirmDeleteLegacy) {
  throw new Error("--delete-legacy requires --confirm-delete-legacy");
}
if (!deleteLegacy && confirmDeleteLegacy) {
  throw new Error("--confirm-delete-legacy is only valid with --delete-legacy");
}

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required");

const legacyPrefix = `${SOKO_BOT_AVATAR_LEGACY_BLOB_DIR}/`;

async function listLegacyBlobs(blobToken: string): Promise<ListedBlob[]> {
  const blobs: ListedBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({
      prefix: legacyPrefix,
      token: blobToken,
      cursor,
      limit: 1000,
    });
    for (const blob of page.blobs) {
      blobs.push({ url: blob.url, pathname: blob.pathname });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

const blobs = await listLegacyBlobs(token);

if (deleteLegacy) {
  if (blobs.length === 0) {
    console.log(`No objects under ${legacyPrefix}`);
  } else {
    await del(
      blobs.map((blob) => blob.url),
      { token },
    );
    console.log(`Deleted ${blobs.length} objects under ${legacyPrefix}`);
  }
} else {
  let copied = 0;
  let skipped = 0;
  for (const blob of blobs) {
    const dest = rewriteLegacySokoBotAvatarBlobPath(blob.pathname);
    if (dest === blob.pathname) {
      skipped += 1;
      continue;
    }
    if (copyMode) {
      await copy(blob.url, dest, {
        access: "public",
        contentType: "image/png",
        token,
        allowOverwrite: true,
      });
    }
    copied += 1;
    console.log(`${blob.pathname} -> ${dest}`);
  }
  const action = copyMode ? "Copied" : "Would copy";
  console.log(
    `${action} ${copied} objects from ${legacyPrefix} to ${SOKO_BOT_AVATAR_BLOB_DIR}/ (${skipped} skipped)`,
  );
}
