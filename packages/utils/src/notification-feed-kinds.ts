import { CHAT_ROOM_MESSAGE_KEYS } from "./chat-notification-message-keys.js";

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
 * Whether a stored notification stays out of the in-app notification center.
 *
 * The kind answers it for every row but one. A chat room message is the
 * reader's own answer to "tell me about every message in this room", and the
 * notification center is the only place that answer can be read back: the
 * sidebar badge counts what was addressed to the reader, and an OS banner is
 * gone the moment it is dismissed. So the room message leaves its kind behind.
 *
 * Mentions and direct messages stay browser-only. The sidebar already counts
 * those, beside the room they are in, which is where a reader goes to answer
 * one.
 */
export function isBrowserOnlyNotification(
  kind: string,
  messageKey: string,
): boolean {
  return (
    isBrowserOnlyNotificationKind(kind) &&
    !CHAT_ROOM_MESSAGE_KEYS.includes(messageKey)
  );
}
