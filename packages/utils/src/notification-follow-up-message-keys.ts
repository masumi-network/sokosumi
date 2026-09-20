export const CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY =
  "Notifications.Chat.mentionedFollowUp";

/**
 * Direct-room mention follow-up. Render-time only: Core stores the named-room
 * key and swaps this in, because naming the room would name the author twice.
 */
export const CHAT_MENTION_DIRECT_FOLLOW_UP_MESSAGE_KEY =
  "Notifications.Chat.mentionedDirectFollowUp";

export const CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY =
  "Notifications.Chat.directMessageFollowUp";

export const TASK_FOLLOW_UP_MESSAGE_KEY = "Notifications.Task.followUp";

/**
 * Kept though nothing writes it any more. SOK-930 removed every job
 * notification; a reminder stored before that must still classify as
 * `FOLLOW_UP`. Dropped from this list it would fall to the defaults: the `JOB`
 * arm of `toNotificationCategory` went with the removal.
 */
export const JOB_FOLLOW_UP_MESSAGE_KEY = "Notifications.Job.followUp";

/**
 * Stored follow-up keys. The render-time direct variant is absent: Core never
 * stores it.
 */
const NOTIFICATION_FOLLOW_UP_MESSAGE_KEYS: readonly string[] = [
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
];

export function isFollowUpMessageKey(messageKey: string): boolean {
  return NOTIFICATION_FOLLOW_UP_MESSAGE_KEYS.includes(messageKey);
}
