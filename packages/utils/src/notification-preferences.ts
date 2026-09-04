/**
 * The vocabulary of the notification preference matrix (SOK-877).
 *
 * A category is a row and a channel is a column. Both are stored as plain
 * strings rather than database enums, so adding either is data plus UI rather
 * than a schema migration. Core validates an incoming value against these
 * lists.
 *
 * Jobs and tasks are three rows each. Something that waits on you and
 * something that merely happened are the same kind to the producer and
 * different things to the reader, and one row for both meant silencing the ones
 * that need you to be rid of the ones that do not. Finishing is the third row:
 * it is the answer the reader was waiting for, and it read as noise only while
 * it sat with the failures and the cancellations.
 *
 * Chat is three rows: every message in a room you belong to, the messages that
 * name you, and your direct messages. The first is the only one that is off
 * until you ask for it (`NOTIFICATION_CATEGORY_OFF_BY_DEFAULT`).
 *
 * Web reads the same vocabulary from the generated Core client, not from here:
 * the Core DTO boundary keeps domain values out of web's direct imports.
 */
export const NOTIFICATION_CATEGORIES = [
  "JOB_ATTENTION",
  "JOB_COMPLETED",
  "JOB_UPDATE",
  "TASK_ATTENTION",
  "TASK_COMPLETED",
  "TASK_UPDATE",
  "CHAT_ROOM_MESSAGE",
  "CHAT_MENTION",
  "CHAT_DIRECT_MESSAGE",
  "SYSTEM",
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/**
 * Where a Notification is delivered.
 *
 * `IN_APP` is one column with two faces, because the product already has two.
 * A feed kind lands in the Notification Center. A browser-only kind lands in
 * the in-app toast and never in the feed at all
 * (`BROWSER_ONLY_NOTIFICATION_KINDS`). Splitting them into separate channels
 * would give every row a cell that controls nothing.
 */
export const NOTIFICATION_CHANNELS = ["IN_APP", "OS_BANNER"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * What a missing row means: in Sokosumi yes, on the device no.
 *
 * Nothing is lost by the second half. Everything Sokosumi showed before this
 * matrix existed still arrives, in Sokosumi, and the settings page opens on
 * one word for every group rather than telling a reader who has touched
 * nothing that they set their notifications by hand.
 *
 * The banner is the part a reader asks for, one group at a time. On by
 * default, the account-wide push opt-in was the only thing between a new
 * account and a banner for every row it has, including the rows nobody reads.
 * Granting that consent is one press, and it was never a press about which
 * rows may interrupt.
 */
const NOTIFICATION_CHANNEL_DEFAULT: Record<NotificationChannel, boolean> = {
  IN_APP: true,
  OS_BANNER: false,
};

/**
 * The categories that stay off until the reader turns them on.
 *
 * The rest default to on in Sokosumi, because they were already arriving
 * before this matrix existed and a default of off would silence them. Every
 * message in a room is the opposite case: nobody receives it today, and
 * switching it on for everyone would write a notification for every member of
 * a room on every message. So it is off, and an absent row means no rather
 * than yes.
 */
const NOTIFICATION_CATEGORY_OFF_BY_DEFAULT: readonly NotificationCategory[] = [
  "CHAT_ROOM_MESSAGE",
];

/** Whether a category and channel is delivered when the reader stored nothing. */
export function notificationDefault(
  category: NotificationCategory | null,
  channel: NotificationChannel,
): boolean {
  // A notification the matrix holds no row for cannot be turned on from the
  // settings page, so it keeps what it had: both channels, with the
  // account-wide opt-in still gating the banner.
  if (category === null) {
    return true;
  }

  if (NOTIFICATION_CATEGORY_OFF_BY_DEFAULT.includes(category)) {
    return false;
  }

  return NOTIFICATION_CHANNEL_DEFAULT[channel];
}
