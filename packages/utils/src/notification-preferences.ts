/**
 * The vocabulary of the notification preference matrix (SOK-877).
 *
 * A category is a row and a channel is a column. Both are stored as plain
 * strings rather than database enums, so adding either is data plus UI rather
 * than a schema migration. Core validates an incoming value against these
 * lists.
 *
 * Tasks are three rows. Something that waits on you and something that merely
 * happened are the same kind to the producer and different things to the
 * reader, and one row for both meant silencing the ones that need you to be
 * rid of the ones that do not. Finishing is the third row: it is the answer
 * the reader was waiting for, and it read as noise only while it sat with the
 * failures and the cancellations.
 *
 * Jobs had the same three rows until SOK-930. An agent job is started through
 * the API and read there, so its rows were switches over notifications nobody
 * writes any more.
 *
 * Chat is three rows: every message in a room you belong to, the messages that
 * name you, and your direct messages. The first is the only one that is off
 * until you ask for it (`NOTIFICATION_CATEGORY_OFF_BY_DEFAULT`).
 *
 * Follow-ups are one row for all of them (SOK-916). It names a kind of timing
 * rather than a kind of event, which makes it the odd one here, but the
 * reader's question is whether they want reminders at all rather than which
 * reminders they want. Silencing a category upstream already silences its
 * follow-ups, because a notification that was never delivered is never
 * followed up.
 *
 * Web reads the same vocabulary from the generated Core client, not from here:
 * the Core DTO boundary keeps domain values out of web's direct imports.
 */
export const NOTIFICATION_CATEGORIES = [
  "TASK_ATTENTION",
  "TASK_COMPLETED",
  "TASK_UPDATE",
  "CHAT_ROOM_MESSAGE",
  "CHAT_MENTION",
  "CHAT_DIRECT_MESSAGE",
  "SYSTEM",
  "FOLLOW_UP",
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
 *
 * `EMAIL` is the one channel that is not offered on every row, for that same
 * reason: a category can only be emailed when something sends the email.
 * `NOTIFICATION_EMAIL_CATEGORIES` is the list of the ones that can.
 */
export const NOTIFICATION_CHANNELS = ["IN_APP", "OS_BANNER", "EMAIL"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * The categories that actually send an email (SOK-916).
 *
 * Follow-ups alone today. A reminder is the one notification whose whole
 * purpose is to reach a reader who is not looking at Sokosumi, so it is the
 * one worth putting in their inbox.
 *
 * This list is what keeps the email column honest. A category absent from it
 * is never drawn with an email switch and never defaults to on, so no reader
 * is shown a switch that controls nothing. A category joins the list in the
 * same change that teaches it to send an email, never before.
 *
 * Deliberately not here: the job failure alert the product still sends. It
 * goes to the agent's author and the stakeholder list rather than to a reader
 * with a settings page, so no row of this matrix speaks for it (SOK-24).
 */
export const NOTIFICATION_EMAIL_CATEGORIES: readonly NotificationCategory[] = [
  "FOLLOW_UP",
];

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
const NOTIFICATION_CHANNEL_DEFAULT: Record<
  Exclude<NotificationChannel, "EMAIL">,
  boolean
> = {
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
  // Asked before the null case below, because that case answers yes and there
  // is no email to send for a category the matrix does not name. It is also
  // the one channel whose default does not depend on the channel alone: a
  // category that sends email defaults to on, and every other category has no
  // email to be on about.
  if (channel === "EMAIL") {
    return (
      category !== null && NOTIFICATION_EMAIL_CATEGORIES.includes(category)
    );
  }

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
