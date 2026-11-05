import type { ChatRoom } from "@sokosumi/core-client";

let remembered: { currentUserId: string; rooms: readonly ChatRoom[] } | null =
  null;

/**
 * The reader's whole Pinned list as the sidebar last drew it. It outlives a
 * workspace switch, which remounts the sidebar and clears the room snapshot, so
 * the new workspace's Pinned rows hold their places until its read lands.
 */
export function rememberPinnedRooms(
  currentUserId: string,
  rooms: readonly ChatRoom[],
): void {
  remembered = { currentUserId, rooms };
}

export function getRememberedPinnedRooms(
  currentUserId: string | null,
): readonly ChatRoom[] {
  return remembered?.currentUserId === currentUserId ? remembered.rooms : [];
}
