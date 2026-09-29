import {
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
} from "./chat-notification-message-keys.js";
import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
} from "./notification-follow-up-message-keys.js";

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
 * Chat keys the notification center keeps despite kind `CHAT`.
 *
 * Mentions and opted-in room messages belong in the feed. Direct messages stay
 * out (the room already is that list). Both chat follow-ups stay in: a
 * reminder arrives once, a day after the room went quiet.
 */
export const CHAT_FEED_MESSAGE_KEYS: readonly string[] = [
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
];

export function isBrowserOnlyNotification(
  kind: string,
  messageKey: string,
): boolean {
  return (
    isBrowserOnlyNotificationKind(kind) &&
    !CHAT_FEED_MESSAGE_KEYS.includes(messageKey)
  );
}

/** Task paused for the reader's input. */
export const TASK_INPUT_REQUIRED_MESSAGE_KEY =
  "Notifications.Task.inputRequired";

/** Job paused for the reader's input. */
export const JOB_INPUT_REQUIRED_MESSAGE_KEY = "Notifications.Job.inputRequired";

/** Workspace vendor-grant request awaiting a decision. */
export const VENDOR_GRANT_PENDING_MESSAGE_KEY =
  "notifications.vendorGrant.pending";

/** Coworker workspace early-access request awaiting a decision. */
export const COWORKER_ACCESS_PENDING_MESSAGE_KEY =
  "notifications.coworkerAccess.pending";

/**
 * Keys the Needs you view can hold. The key says the row asked; whether it is
 * still asking is Core's to decide from the record.
 */
export const NEEDS_ACTION_MESSAGE_KEYS: readonly string[] = [
  TASK_INPUT_REQUIRED_MESSAGE_KEY,
  JOB_INPUT_REQUIRED_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
];

export function isNeedsActionNotification(messageKey: string): boolean {
  return NEEDS_ACTION_MESSAGE_KEYS.includes(messageKey);
}

/**
 * Keys the Mentions view holds: rows where someone named the reader. A direct
 * message is not a mention, so neither it nor its reminder is here.
 */
export const MENTION_MESSAGE_KEYS: readonly string[] = [
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
];

export function isMentionNotification(messageKey: string): boolean {
  return MENTION_MESSAGE_KEYS.includes(messageKey);
}
