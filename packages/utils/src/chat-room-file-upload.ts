import { FILE_UPLOAD_MAX_SIZE_BYTES } from "./task-file-upload.js";
import { sanitizeUserUploadFilename } from "./user-upload-path.js";

const USER_UPLOADS_DIR = "users";
const COWORKER_UPLOADS_DIR = "coworkers";
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

function isOwnedPrefixUrl(url: string, prefix: string): boolean {
  try {
    const { pathname } = new URL(url);
    const decoded = decodeURIComponent(pathname.replace(/^\/+/, ""));
    return decoded === prefix.slice(0, -1) || decoded.startsWith(prefix);
  } catch {
    return false;
  }
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
