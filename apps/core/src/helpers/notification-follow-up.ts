import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  JOB_FOLLOW_UP_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";

import {
  JOB_ATTENTION_MESSAGE_KEYS,
  TASK_ATTENTION_MESSAGE_KEYS,
} from "@/helpers/notification-delivery";

/**
 * Which notifications get a follow-up, and what the follow-up is stored as
 * (SOK-916).
 *
 * One map rather than a list plus a switch, because the two questions are one
 * question: a key is eligible exactly when there is a reminder to write for it.
 * A key absent from here is not followed up, which is the safe way round. A key
 * added to a family later is silent until someone decides what its reminder
 * says.
 *
 * Every source key is one that waits on the reader. The task and job halves are
 * the attention lists the delivery module already keeps, so this adds no second
 * list to hold in step with them. The chat half is the pair the room badge
 * already counts, on the same stated grounds: they are the chat notifications
 * addressed to the reader rather than merely near them.
 *
 * Deliberately not here: everything a reader can read later without anyone
 * waiting. A completed task, a canceled one, a failed job, every message in a
 * room. A reminder about those is noise about work that is already done.
 *
 * No follow-up key is a source key, which is what makes "one reminder, never
 * two" true by construction rather than by counting.
 */
const FOLLOW_UP_KEY_BY_SOURCE_KEY = new Map<string, string>([
  [CHAT_MENTION_MESSAGE_KEY, CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY],
  [CHAT_DIRECT_MESSAGE_MESSAGE_KEY, CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY],
  ...TASK_ATTENTION_MESSAGE_KEYS.map((key): [string, string] => [
    key,
    TASK_FOLLOW_UP_MESSAGE_KEY,
  ]),
  ...JOB_ATTENTION_MESSAGE_KEYS.map((key): [string, string] => [
    key,
    JOB_FOLLOW_UP_MESSAGE_KEY,
  ]),
]);

/**
 * Every message key a follow-up can be written for.
 *
 * The only list the query needs. A message key already names its family, so
 * filtering on the kind as well would narrow nothing and would be a second list
 * to hold in step with this one.
 */
export const FOLLOW_UP_SOURCE_MESSAGE_KEYS: readonly string[] = [
  ...FOLLOW_UP_KEY_BY_SOURCE_KEY.keys(),
];

/** What this notification's reminder is stored as, or null when it gets none. */
export function followUpMessageKeyFor(sourceMessageKey: string): string | null {
  return FOLLOW_UP_KEY_BY_SOURCE_KEY.get(sourceMessageKey) ?? null;
}

/**
 * The event id a notification's one follow-up takes.
 *
 * Derived from the original rather than random, so the uniqueness the
 * notification table already enforces is what stops a second reminder. A re-run
 * writes nothing and needs no record of its own that it ran.
 */
export function followUpEventId(sourceNotificationId: string): string {
  return `follow-up:${sourceNotificationId}`;
}
