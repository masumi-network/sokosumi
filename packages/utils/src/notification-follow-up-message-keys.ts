/**
 * The message keys a follow-up notification is stored under (SOK-916).
 *
 * A follow-up says the same thing the original said, a day later, to a reader
 * who never opened it. It is a notification of its own rather than a repeat of
 * the original, so it needs a key of its own: the reader must be able to tell a
 * reminder from the thing arriving twice.
 *
 * One key per family rather than one per source key. Each family's attention
 * keys already carry the same message parameters as one another, so a single
 * line can be written for all of them, and a reader does not need a different
 * sentence for a task that wants input and one that wants approval. What they
 * need is to be told it is still waiting.
 *
 * Plain strings, like every other message key: the other half of each one is a
 * catalog entry under `Library.Notifications` that neither app owns.
 */

/** A mention nobody opened, in a room with a name of its own. */
export const CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY =
  "Notifications.Chat.mentionedFollowUp";

/**
 * A mention nobody opened, in a room of two.
 *
 * Such a room is named after the other person, who in a mention is whoever
 * wrote it, so naming the room would name them twice. The reader is told there
 * is a reply outstanding instead. Stored under the key above and swapped for
 * this one at render time, the way the original mention already is.
 */
export const CHAT_MENTION_DIRECT_FOLLOW_UP_MESSAGE_KEY =
  "Notifications.Chat.mentionedDirectFollowUp";

/** A direct message nobody opened. */
export const CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY =
  "Notifications.Chat.directMessageFollowUp";

/** A task that is still waiting on the reader. */
export const TASK_FOLLOW_UP_MESSAGE_KEY = "Notifications.Task.followUp";

/**
 * A job that is still waiting on the reader.
 *
 * Kept though nothing writes it any more. SOK-930 removed every job
 * notification, and a reminder stored before that has to go on classifying as
 * `FOLLOW_UP`. Dropped from this list it would classify as nothing at all:
 * the `JOB` arm of `toNotificationCategory` went with the removal, so the row
 * would fall to the defaults rather than to the reader's own answer.
 */
export const JOB_FOLLOW_UP_MESSAGE_KEY = "Notifications.Job.followUp";

/**
 * Every key a follow-up is stored under.
 *
 * The render-time direct variant is deliberately absent: Core never stores it,
 * so a stored row carrying it is not a thing this list should admit to.
 *
 * Kept inside this module. `isFollowUpMessageKey` is the whole of the question
 * anyone outside asks, and a list every caller could reach for is a list every
 * caller could loop over instead of naming what they mean.
 */
const NOTIFICATION_FOLLOW_UP_MESSAGE_KEYS: readonly string[] = [
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
];

/** Whether a stored notification is itself a follow-up. */
export function isFollowUpMessageKey(messageKey: string): boolean {
  return NOTIFICATION_FOLLOW_UP_MESSAGE_KEYS.includes(messageKey);
}
