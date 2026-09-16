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
 * Both chat follow-ups are here, the direct one included. The reason direct
 * messages stay off does not reach them: a follow-up arrives once, a day after
 * the room went quiet, so a list of them is a list of what is still waiting
 * rather than a second copy of anything. A reminder the reader cannot find
 * afterwards would also be the one notification most worth finding.
 *
 * Whether either actually arrives is still the reader's own setting: the row
 * carries the in-app answer its category resolved to, and the feed reads that.
 */
export const CHAT_FEED_MESSAGE_KEYS: readonly string[] = [
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
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

/** Message key of a task paused for the reader's input. */
export const TASK_INPUT_REQUIRED_MESSAGE_KEY =
  "Notifications.Task.inputRequired";

/** Message key of a job paused for the reader's input. */
export const JOB_INPUT_REQUIRED_MESSAGE_KEY = "Notifications.Job.inputRequired";

/** Message key of a workspace vendor-grant request awaiting a decision. */
export const VENDOR_GRANT_PENDING_MESSAGE_KEY =
  "notifications.vendorGrant.pending";

/** Message key of a coworker workspace early-access request awaiting a decision. */
export const COWORKER_ACCESS_PENDING_MESSAGE_KEY =
  "notifications.coworkerAccess.pending";

/**
 * The keys whose row is a request the reader still has to answer.
 *
 * The Needs you view lists these, and only these, while the record each row
 * points at is still waiting: a task or job paused on input, a vendor grant or
 * coworker access request nobody has accepted or denied. The key alone says
 * the row asked; whether it is still asking is Core's to decide from the
 * record. Web reads the same list to keep rows that never asked out of the
 * view while a realtime event puts them into the shared feed.
 *
 * Not Core's attention lists: those also hold keys that only inform (a task
 * assigned, a schedule removed) or pauses the view does not cover yet.
 * Other task pauses (approval, sign-in, credits) also wait on the reader and
 * are the next keys to add here, each with its pending rule in Core.
 */
export const NEEDS_ACTION_MESSAGE_KEYS: readonly string[] = [
  TASK_INPUT_REQUIRED_MESSAGE_KEY,
  JOB_INPUT_REQUIRED_MESSAGE_KEY,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
];

/** Whether a row's key is one the Needs you view can hold. */
export function isNeedsActionNotification(messageKey: string): boolean {
  return NEEDS_ACTION_MESSAGE_KEYS.includes(messageKey);
}
