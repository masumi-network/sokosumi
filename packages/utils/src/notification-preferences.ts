/**
 * The vocabulary of the notification preference matrix (SOK-877).
 *
 * A category is a row and a channel is a column. Both are stored as plain
 * strings rather than database enums, so adding either is data plus UI rather
 * than a schema migration. Core validates an incoming value against these
 * lists.
 *
 * Web reads the same vocabulary from the generated Core client, not from here:
 * the Core DTO boundary keeps domain values out of web's direct imports.
 */
export const NOTIFICATION_CATEGORIES = [
  "JOB",
  "TASK",
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
 * What a missing row means.
 *
 * Both on, so a reader who never opens the matrix keeps exactly what they get
 * today. That is safe for the OS banner column too: the account-wide push
 * opt-in still gates every banner, and it is off until the reader turns it on.
 * A default of off there would instead silence a reader who did opt in and
 * never touched the matrix.
 */
export const NOTIFICATION_CHANNEL_DEFAULT: Record<
  NotificationChannel,
  boolean
> = {
  IN_APP: true,
  OS_BANNER: true,
};
