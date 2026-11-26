/**
 * Marks the occurrence a follow-up's one retry is handed over with; the
 * event it stands for is the same Task event, without the suffix.
 */
export const FOLLOW_UP_RETRY_SUFFIX = ":follow-up-retry";

/** The Task or Job event an inbox occurrence stands for. */
export function occurrenceEventId(eventId: string): string {
  return eventId.endsWith(FOLLOW_UP_RETRY_SUFFIX)
    ? eventId.slice(0, -FOLLOW_UP_RETRY_SUFFIX.length)
    : eventId;
}
