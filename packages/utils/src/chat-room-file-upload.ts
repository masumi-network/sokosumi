import { isVercelBlobPublicHost } from "./entity-image-upload.js";
import { FILE_UPLOAD_MAX_SIZE_BYTES } from "./task-file-upload.js";
import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const USER_UPLOADS_DIR = "users";
const COWORKER_UPLOADS_DIR = "coworkers";
const SOKO_BOT_UPLOADS_DIR = "soko-bots";
const CHATS_DIR = "chats";

/** Max file size for room chat attaches (same as user/task direct uploads). */
export const CHAT_ROOM_FILE_MAX_SIZE_BYTES = FILE_UPLOAD_MAX_SIZE_BYTES;

export function buildUserChatRoomFilePrefix(
  userId: string,
  roomId: string,
): string {
  return `${USER_UPLOADS_DIR}/${userId}/${CHATS_DIR}/${roomId}/`;
}

export function buildCoworkerChatRoomFilePrefix(
  coworkerId: string,
  roomId: string,
): string {
  return `${COWORKER_UPLOADS_DIR}/${coworkerId}/${CHATS_DIR}/${roomId}/`;
}

export function buildSokoBotChatRoomFilePrefix(
  sokoBotId: string,
  roomId: string,
): string {
  return `${SOKO_BOT_UPLOADS_DIR}/${sokoBotId}/${CHATS_DIR}/${roomId}/`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `users/{userId}/chats/{roomId}/report.pdf`
 */
export function buildUserChatRoomFilePathname(
  userId: string,
  roomId: string,
  fileName: string,
): string {
  return `${buildUserChatRoomFilePrefix(userId, roomId)}${sanitizeUserUploadFilename(fileName)}`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `coworkers/{coworkerId}/chats/{roomId}/notes.txt`
 */
export function buildCoworkerChatRoomFilePathname(
  coworkerId: string,
  roomId: string,
  fileName: string,
): string {
  return `${buildCoworkerChatRoomFilePrefix(coworkerId, roomId)}${sanitizeUserUploadFilename(fileName)}`;
}

/**
 * Base pathname before Vercel Blob applies a random suffix.
 * Example: `soko-bots/{sokoBotId}/chats/{roomId}/notes.txt`
 */
export function buildSokoBotChatRoomFilePathname(
  sokoBotId: string,
  roomId: string,
  fileName: string,
): string {
  return `${buildSokoBotChatRoomFilePrefix(sokoBotId, roomId)}${sanitizeUserUploadFilename(fileName)}`;
}

function isOwnedPrefixUrl(url: string, prefix: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (!isVercelBlobPublicHost(parsed.hostname)) {
      return false;
    }
    const decoded = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    return decoded === prefix.slice(0, -1) || decoded.startsWith(prefix);
  } catch {
    return false;
  }
}

const CHAT_ROOM_FILE_PATH =
  /^(?:users|coworkers|soko-bots)\/[^/]+\/chats\/([0-9a-f-]{36})\/([^/]+)$/i;

/**
 * The room a chat attachment was uploaded to, read from its public Blob URL
 * (`{sender}/{id}/chats/{roomId}/{file}`); null for any other URL.
 */
export function parseChatRoomFileUrl(
  url: string,
): { roomId: string; fileName: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    if (!isVercelBlobPublicHost(parsed.hostname)) return null;
    const match = CHAT_ROOM_FILE_PATH.exec(
      decodeURIComponent(parsed.pathname.replace(/^\/+/, "")),
    );
    return match?.[1] && match[2]
      ? { roomId: match[1].toLowerCase(), fileName: match[2] }
      : null;
  } catch {
    return null;
  }
}

/** Chat attachments linked in a message's markdown, in order, without repeats. */
export function chatRoomFileLinks(
  content: string,
): { name: string; url: string }[] {
  const links = new Map<string, string>();
  for (const match of content.matchAll(
    /!?\[([^[\]]{0,500})\]\((https:\/\/[^)\s]{1,2048})\)/g,
  )) {
    const [, label = "", url = ""] = match;
    const file = parseChatRoomFileUrl(url);
    if (file && !links.has(url)) links.set(url, label.trim() || file.fileName);
  }
  return [...links].map(([url, name]) => ({ name, url }));
}

export function isOwnedUserChatRoomFileUrl(
  url: string,
  userId: string,
  roomId: string,
): boolean {
  return isOwnedPrefixUrl(url, buildUserChatRoomFilePrefix(userId, roomId));
}

export function isOwnedCoworkerChatRoomFileUrl(
  url: string,
  coworkerId: string,
  roomId: string,
): boolean {
  return isOwnedPrefixUrl(
    url,
    buildCoworkerChatRoomFilePrefix(coworkerId, roomId),
  );
}

export function isOwnedSokoBotChatRoomFileUrl(
  url: string,
  sokoBotId: string,
  roomId: string,
): boolean {
  return isOwnedPrefixUrl(
    url,
    buildSokoBotChatRoomFilePrefix(sokoBotId, roomId),
  );
}
