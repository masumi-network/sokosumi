import type { NotificationKind } from "@sokosumi/database";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNEL_DEFAULT,
  NOTIFICATION_CHANNELS,
  type NotificationCategory,
  type NotificationChannel,
} from "@sokosumi/utils";

/** The message key an @mention carries. Read by the category mapping below. */
export const CHAT_MENTION_MESSAGE_KEY = "Notifications.Chat.mentioned";

/** The message key a direct message carries. */
export const CHAT_DIRECT_MESSAGE_MESSAGE_KEY =
  "Notifications.Chat.directMessage";

/**
 * The task keys that wait on the reader.
 *
 * A task that needs input, approval, authentication or credits stops until the
 * reader acts. Everything else a task emits is an outcome they can read later,
 * so the two are separate rows and the loud one can stay on while the quiet one
 * goes off. A key added later is an update until it is listed here, which is
 * the safe way round: an unknown key is never louder than the reader asked for.
 */
export const TASK_ATTENTION_MESSAGE_KEYS: readonly string[] = [
  "Notifications.Task.inputRequired",
  "Notifications.Task.approvalRequired",
  "Notifications.Task.authenticationRequired",
  "Notifications.Task.outOfCredits",
  "Notifications.Task.scheduleRemovedByOperator",
];

/** The job keys that wait on the reader. Same split as the task keys. */
export const JOB_ATTENTION_MESSAGE_KEYS: readonly string[] = [
  "Notifications.Job.inputRequired",
  "Notifications.Job.paymentFailed",
];

/**
 * One stored choice, as the database holds it: strings rather than the unions,
 * because a row written by an older build can name a category or a channel this
 * build no longer knows.
 */
export interface StoredNotificationPreference {
  category: string;
  channel: string;
  enabled: boolean;
}

export interface NotificationDeliveryInput {
  category: NotificationCategory | null;
  preferences: readonly StoredNotificationPreference[];
  /** The account-wide push consent. Off means no banner, whatever the row says. */
  pushOptIn: boolean;
}

/** Where one Notification goes. */
export interface NotificationDelivery {
  /** The Notification Center for a feed kind, the in-app toast for a chat one. */
  inApp: boolean;
  osBanner: boolean;
}

/**
 * The matrix row a Notification belongs to, or null when it belongs to none.
 *
 * Every kind splits by message key, because a reader chooses between an
 * @mention and a direct message, or between a task that waits on them and a
 * task that finished, rather than between the kinds a producer happens to
 * emit.
 *
 * Null means the defaults apply and nothing is stored against it: a chat key
 * added later that nobody mapped, and BILLING, which no producer emits yet. A
 * row would be a switch that controls nothing, so there is none.
 */
export function toNotificationCategory(
  kind: NotificationKind,
  messageKey: string,
): NotificationCategory | null {
  switch (kind) {
    case "JOB":
      return JOB_ATTENTION_MESSAGE_KEYS.includes(messageKey)
        ? "JOB_ATTENTION"
        : "JOB_UPDATE";
    case "TASK":
      return TASK_ATTENTION_MESSAGE_KEYS.includes(messageKey)
        ? "TASK_ATTENTION"
        : "TASK_UPDATE";
    case "SYSTEM":
      return "SYSTEM";
    case "CHAT":
      if (messageKey === CHAT_MENTION_MESSAGE_KEY) {
        return "CHAT_MENTION";
      }
      if (messageKey === CHAT_DIRECT_MESSAGE_MESSAGE_KEY) {
        return "CHAT_DIRECT_MESSAGE";
      }
      return null;
    default:
      return null;
  }
}

function isEnabled(
  category: NotificationCategory | null,
  channel: NotificationChannel,
  preferences: readonly StoredNotificationPreference[],
): boolean {
  const stored = preferences.find(
    (preference) =>
      preference.category === category && preference.channel === channel,
  );

  return stored?.enabled ?? NOTIFICATION_CHANNEL_DEFAULT[channel];
}

/**
 * The one place that decides where a Notification is delivered.
 *
 * Both answers are returned together rather than asked separately, so a caller
 * cannot read one gate and forget the other. Neither answer stops the
 * Notification being written: `inApp` false hides it from the feed and the
 * toast, and leaves the row that keeps a duplicate emit idempotent.
 */
export function resolveNotificationDelivery({
  category,
  preferences,
  pushOptIn,
}: NotificationDeliveryInput): NotificationDelivery {
  return {
    inApp: isEnabled(category, "IN_APP", preferences),
    osBanner: pushOptIn && isEnabled(category, "OS_BANNER", preferences),
  };
}

/** One cell of the matrix the reader sees, with its answer already resolved. */
export interface NotificationMatrixCell {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

/**
 * The whole matrix, one cell per category and channel.
 *
 * Complete rather than sparse, so the reader's settings page renders what it
 * is given and the defaults stay in one place. A stored row that names a
 * category or a channel this build does not know belongs to no cell and is
 * dropped.
 */
export function resolveNotificationMatrix(
  preferences: readonly StoredNotificationPreference[],
): NotificationMatrixCell[] {
  return NOTIFICATION_CATEGORIES.flatMap((category) =>
    NOTIFICATION_CHANNELS.map((channel) => ({
      category,
      channel,
      enabled: isEnabled(category, channel, preferences),
    })),
  );
}
