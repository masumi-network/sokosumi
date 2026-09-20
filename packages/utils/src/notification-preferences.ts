/**
 * Preference matrix rows. Stored as plain strings, not database enums.
 * Web reads the same vocabulary from the generated Core client, not from here.
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
 * `IN_APP` is one column with two faces: feed kinds land in the Notification
 * Center; browser-only kinds land in the toast
 * (`BROWSER_ONLY_NOTIFICATION_KINDS`).
 */
export const NOTIFICATION_CHANNELS = ["IN_APP", "OS_BANNER", "EMAIL"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * The categories that actually send an email.
 *
 * Everything addressed to the reader, and the reminders about it. A mention,
 * a direct message, a task that stopped for them, a task that finished and a
 * request for a workspace they manage each reach the inbox (SOK-1090), as
 * does the reminder a day later (SOK-916).
 *
 * Deliberately absent: every message in a room, which would mail a busy room
 * per message, and the other task updates, which ask nothing of the reader.
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
  "TASK_ATTENTION",
  "TASK_COMPLETED",
  "CHAT_MENTION",
  "CHAT_DIRECT_MESSAGE",
  "SYSTEM",
  "FOLLOW_UP",
];

const NOTIFICATION_CHANNEL_DEFAULT: Record<
  Exclude<NotificationChannel, "EMAIL">,
  boolean
> = {
  IN_APP: true,
  OS_BANNER: false,
};

/** Off until the reader turns them on; on-by-default would notify every member of every message. */
const NOTIFICATION_CATEGORY_OFF_BY_DEFAULT: readonly NotificationCategory[] = [
  "CHAT_ROOM_MESSAGE",
];

export function notificationDefault(
  category: NotificationCategory | null,
  channel: NotificationChannel,
): boolean {
  // EMAIL before the null case: that case answers yes, and unnamed categories
  // have no email. Categories that send email default on.
  if (channel === "EMAIL") {
    return (
      category !== null && NOTIFICATION_EMAIL_CATEGORIES.includes(category)
    );
  }

  // No matrix row: cannot be turned on from settings, so keep both channels
  // (account-wide opt-in still gates the banner).
  if (category === null) {
    return true;
  }

  if (NOTIFICATION_CATEGORY_OFF_BY_DEFAULT.includes(category)) {
    return false;
  }

  return NOTIFICATION_CHANNEL_DEFAULT[channel];
}
