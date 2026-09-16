import * as Sentry from "@sentry/node";
import { ssrfSafeFetch } from "@sokosumi/net";
import {
  buildChatRoomUnfurlSnapshotPathname,
  CHAT_ROOM_UNFURL_SNAPSHOT_MAX_SIZE_BYTES,
  isChatRoomUnfurlSnapshotAllowedContentType,
  isOwnedChatRoomUnfurlSnapshotUrl,
  sniffImageMimeFromBytes,
} from "@sokosumi/utils";
import { del, put } from "@vercel/blob";

import { getEnv } from "@/config/env";
import { UNFURL_USER_AGENT } from "@/lib/chat-unfurl-scrape";
import { attachUploadToLogger } from "@/lib/evlog";

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
 * Lives beside the scraper rather than in `lib/blob.ts`: the upload half
 * matches `uploadCoworkerImage` there, but the download half is unfurl
 * domain (scraper UA, SSRF fetch, byte sniffing), and `blob.ts` never fetches.
 */
export async function snapshotChatRoomUnfurlImage(
  params: SnapshotChatRoomUnfurlImageParams,
): Promise<string | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) return null;

  let response: Response;
  try {
    response = await ssrfSafeFetch(params.imageUrl, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      maxResponseBytes: CHAT_ROOM_UNFURL_SNAPSHOT_MAX_SIZE_BYTES,
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return null;
  }
  // Trust the bytes, not the header: a mislabelled PNG still stores, an SVG
  // or HTML page served as image/png does not.
  const contentType = sniffImageMimeFromBytes(bytes);
  if (
    contentType === null ||
    !isChatRoomUnfurlSnapshotAllowedContentType(contentType)
  ) {
    return null;
  }

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
