import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "./chat-notification-message-keys.js";

/**
 * Notification kinds that still create rows + realtime events (browser OS
 * alerts, chat room attention) but must not appear in the in-app notification
 * center.
 *
 * String literals only — no Prisma or generated Core DTO enums. Consumers
 * narrow against their own NotificationKind types at the package boundary.
 */
export const BROWSER_ONLY_NOTIFICATION_KINDS = ["CHAT"] as const;

export type BrowserOnlyNotificationKind =
  (typeof BROWSER_ONLY_NOTIFICATION_KINDS)[number];

function isBrowserOnlyNotificationKind(
  kind: string,
): kind is BrowserOnlyNotificationKind {
  return (BROWSER_ONLY_NOTIFICATION_KINDS as readonly string[]).includes(kind);
}

/**
 * The chat keys the notification center keeps, despite their kind.
 *
 * A mention is addressed to the reader by name, so it belongs where the reader
 * looks for what is waiting on them. The sidebar badge says which room it was
 * in; it cannot say who wrote it or what they said, and it is gone the moment
 * the room is read. A room message is here because the reader asked to be told
 * about every message, and the center is the only surface that keeps what it
 * was told.
 *
 * A direct message stays off the list. Every message in a direct room is
 * addressed to the reader, so keeping them would make the center a second copy
 * of the room.
 *
 * Whether either actually arrives is still the reader's own setting: the row
 * carries the in-app answer its category resolved to, and the feed reads that.
 */
export const CHAT_FEED_MESSAGE_KEYS: readonly string[] = [
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
];

/**
 * Whether a stored notification stays out of the in-app notification center.
 *
 * The kind answers it for every row but the chat keys listed above.
 *
 * A direct message stays browser-only. Every message in a direct room is
 * addressed to the reader, so keeping them would make the center a second copy
 * of the room rather than a list of what is waiting.
 */
export function isBrowserOnlyNotification(
  kind: string,
  messageKey: string,
): boolean {
  return (
    isBrowserOnlyNotificationKind(kind) &&
    !CHAT_FEED_MESSAGE_KEYS.includes(messageKey)
  );
}
