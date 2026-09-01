import type { NotificationKind } from "@sokosumi/database";
import {
  NOTIFICATION_CHANNEL_DEFAULT,
  type NotificationCategory,
  type NotificationChannel,
} from "@sokosumi/utils";

/** The message key an @mention carries. Read by the category mapping below. */
export const CHAT_MENTION_MESSAGE_KEY = "Notifications.Chat.mentioned";

/** The message key a direct message carries. */
export const CHAT_DIRECT_MESSAGE_MESSAGE_KEY =
  "Notifications.Chat.directMessage";

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
 * Chat splits by message key, because a reader chooses between an @mention and
 * a direct message rather than between two kinds. Every other kind is its own
 * row.
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
      return "JOB";
    case "TASK":
      return "TASK";
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
