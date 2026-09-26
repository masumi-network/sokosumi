/**
 * Ably contract for Room read receipts — a member advanced their Room
 * last-read. Core publishes; web parses — keep the event name in one place.
 *
 * Its own event name on the room channel rather than a member of the
 * room-message patch union: that union is keyed by message id, and a read
 * receipt is keyed by room and user.
 */

export const CHAT_ROOM_READ_EVENT_NAME = "chat_room_read";
