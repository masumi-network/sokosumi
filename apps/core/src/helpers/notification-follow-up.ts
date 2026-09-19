import {
  CHAT_DIRECT_MESSAGE_FOLLOW_UP_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_FOLLOW_UP_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  TASK_FOLLOW_UP_MESSAGE_KEY,
} from "@sokosumi/utils";

import { TASK_ATTENTION_MESSAGE_KEYS } from "@/helpers/notification-delivery";

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
 * Every source key is one that waits on the reader. The task half is the
 * attention list the delivery module already keeps, so this adds no second
 * list to hold in step with it. The chat half is the pair the room badge
 * already counts, on the same stated grounds: they are the chat notifications
 * addressed to the reader rather than merely near them.
 *
 * Jobs are absent since SOK-930: a job writes no notification for a reminder
 * to follow.
 *
 * Deliberately not here: everything a reader can read later without anyone
 * waiting. A completed task, a canceled one, every message in a room. A
 * reminder about those is noise about work that is already done.
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
 * The event id a follow-up takes, which is what makes it the only one.
 *
 * Derived rather than random, so the uniqueness the notification table already
 * enforces is what stops a second reminder. A re-run writes nothing and needs
 * no record of its own that it ran.
 *
 * Two parts, and each is there to stop a different failure.
 *
 * The reference is what makes SOK-916 user story 26 true: twenty unread
 * mentions in one room are twenty rows, and a per-row id would be twenty
 * reminders. The table is unique on
 * `(userId, kind, referenceId, eventId, messageKey)`, so with the reference in
 * here the reader gets one reminder per room or per task.
 *
 * The day is what stops that from muting the room for good. A follow-up row is
 * never cleaned up: a reader can only mark a row read, and the sole deletes in
 * the codebase are two unrelated SYSTEM ones. So a key that named only the room
 * would be held for the life of the account, and a mention next year would be
 * refused as a duplicate of a reminder sent this one. The day is taken from the source row rather than
 * from the clock, because consecutive runs overlap by an hour and must derive
 * the same key for the same row.
 *
 * The seam to know about: a room whose unread rows straddle midnight UTC gets
 * two reminders for them rather than one. The window a run examines is two
 * hours wide, so it crosses at most one midnight and one run can emit at most
 * two reminders for one room. Across days the count is meant to grow: a room
 * with unread rows arriving on five days is five reminders, one per day.
 *
 * The other consequence: the task attention keys all share one follow-up
 * message key, so a task that asked for input and then for approval on the
 * same day gets one reminder. A mention and a direct message in one room stay
 * two, because their reminders are stored under different message keys.
 */
export function followUpEventId(referenceId: string, waitedFrom: Date): string {
  const day = waitedFrom.toISOString().slice(0, "YYYY-MM-DD".length);

  return `follow-up:${referenceId}:${day}`;
}
