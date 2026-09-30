import * as Sentry from "@sentry/node";
import {
  buildChatRoomUnfurlSnapshotPathname,
  CHAT_ROOM_UNFURL_SNAPSHOT_MAX_SIZE_BYTES,
  isChatRoomUnfurlSnapshotAllowedContentType,
  isOwnedChatRoomUnfurlSnapshotUrl,
} from "@sokosumi/utils";
import { del, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { UNFURL_USER_AGENT } from "@/lib/chat-unfurl-scrape";
import { attachUploadToLogger } from "@/lib/evlog";
import { downloadRemoteImage } from "@/lib/remote-image";

/** Same per-URL budget as the page scrape. */
const DOWNLOAD_TIMEOUT_MS = 8_000;

const REQUEST_HEADERS = {
  "User-Agent": UNFURL_USER_AGENT,
  Accept: "image/png,image/jpeg,image/webp,image/gif,image/*;q=0.8",
} as const;

export interface SnapshotChatRoomUnfurlImageParams {
  roomId: string;
  messageId: string;
  imageUrl: string;
}

/**
 * Download a page's preview image and store it in Vercel Blob under the
 * message (ADR 0030). Returns the stored URL, or null when Blob is not
 * configured or the source is not a usable raster image; the caller keeps
 * the source URL then.
 *
 * Lives beside the scraper rather than in `lib/blob.ts`: it downloads with
 * the scraper UA, and `blob.ts` never fetches.
 */
export async function snapshotChatRoomUnfurlImage(
  params: SnapshotChatRoomUnfurlImageParams,
): Promise<string | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  const image = await downloadRemoteImage(params.imageUrl, {
    headers: REQUEST_HEADERS,
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
    maxBytes: CHAT_ROOM_UNFURL_SNAPSHOT_MAX_SIZE_BYTES,
    isAllowedContentType: isChatRoomUnfurlSnapshotAllowedContentType,
  });
  if (!image) return null;
  const { bytes, contentType } = image;

  const pathname = buildChatRoomUnfurlSnapshotPathname(
    params.roomId,
    params.messageId,
    contentType,
  );
  try {
    attachUploadToLogger({
      filename: pathname.split("/").pop() || pathname,
      size: bytes.byteLength,
      mimeType: contentType,
    });
    const stored = await put(pathname, bytes, {
      access: "public",
      contentType,
      token,
      addRandomSuffix: true,
    });
    return stored.url;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { function: "snapshotChatRoomUnfurlImage" },
      extra: { roomId: params.roomId, messageId: params.messageId },
    });
    return null;
  }
}

/**
 * Best-effort delete of snapshots that live under this message's prefix.
 * Source image URLs and other messages' snapshots are skipped.
 */
export async function deleteChatRoomUnfurlSnapshotsIfOwned(
  urls: ReadonlyArray<string | null | undefined>,
  roomId: string,
  messageId: string,
): Promise<void> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return;

  for (const url of urls) {
    if (!url || !isOwnedChatRoomUnfurlSnapshotUrl(url, roomId, messageId)) {
      continue;
    }
    try {
      await del(url, { token });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { function: "deleteChatRoomUnfurlSnapshotsIfOwned" },
        extra: { roomId, messageId, url },
      });
    }
  }
}
