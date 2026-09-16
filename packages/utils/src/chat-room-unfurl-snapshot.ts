import {
  buildEntityImagePathname,
  isEntityImageAllowedContentType,
  isOwnedEntityImageUrl,
} from "./entity-image-upload.js";

const CHATS_DIR = "chats";
const UNFURLS_DIR = "unfurls";
const SNAPSHOT_FILENAME = "preview";

/**
 * Max bytes Core downloads for one unfurl snapshot. Open Graph images are
 * usually well under 1 MB; this bounds a hostile or careless host.
 */
export const CHAT_ROOM_UNFURL_SNAPSHOT_MAX_SIZE_BYTES = 5 * 1024 * 1024;

function snapshotDirectory(roomId: string): string {
  return `${CHATS_DIR}/${roomId}/${UNFURLS_DIR}`;
}

/** Raster image types only; SVG is excluded on purpose. */
export function isChatRoomUnfurlSnapshotAllowedContentType(
  contentType: string,
): boolean {
  return isEntityImageAllowedContentType(contentType);
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `chats/{roomId}/unfurls/{messageId}/image-preview.png`
 */
export function buildChatRoomUnfurlSnapshotPathname(
  roomId: string,
  messageId: string,
  contentType: string,
): string {
  return buildEntityImagePathname(
    snapshotDirectory(roomId),
    messageId,
    SNAPSHOT_FILENAME,
    contentType,
  );
}

/**
 * True when `url` is a public Vercel Blob URL under this message's snapshot
 * prefix. Source image URLs and other messages' snapshots are not owned.
 */
export function isOwnedChatRoomUnfurlSnapshotUrl(
  url: string,
  roomId: string,
  messageId: string,
): boolean {
  return isOwnedEntityImageUrl(url, snapshotDirectory(roomId), messageId);
}
