/**
 * Shared Ably contract for chat sidebar collection invalidation (SOK-986).
 * Core publishes on the per-user chat control channel after archive, restore,
 * and invitation lifecycle changes; web refreshes only the named collections.
 */

export const CHAT_ROOMS_CHANGED_EVENT_NAME = "chat_rooms_changed";

export const CHAT_ROOM_COLLECTIONS = [
  "active",
  "archived",
  "invitations",
] as const;

export type ChatRoomCollection = (typeof CHAT_ROOM_COLLECTIONS)[number];
