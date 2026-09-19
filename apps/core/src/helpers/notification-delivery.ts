import type { NotificationKind } from "@sokosumi/database";
import {
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_ROOM_MESSAGE_MESSAGE_KEY,
  isFollowUpMessageKey,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EMAIL_CATEGORIES,
  type NotificationCategory,
  type NotificationChannel,
  notificationDefault,
  TASK_INPUT_REQUIRED_MESSAGE_KEY,
} from "@sokosumi/utils";

/**
 * The chat notifications a room's badge counts.
 *
 * The badge is the number beside a room in the sidebar, and it has always meant
 * "something here was addressed to you": an @mention, or a message in a direct
 * room, where every message is. It is listed here rather than inferred from the
 * kind, because every chat notification is written as `NotificationKind.CHAT`
 * with the room as its `referenceId`, so the kind cannot tell them apart.
 *
 * Every message in a room is deliberately absent. A reader who asks for those
 * is asking to hear about them, not to be told each one was addressed to them,
 * and counting them turned the badge into an unread-message count for anyone
 * who switched the row on.
 */
export const CHAT_ROOM_BADGE_MESSAGE_KEYS: readonly string[] = [
  CHAT_MENTION_MESSAGE_KEY,
  CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
];

/**
 * The key an operator-removed schedule carries.
 *
 * Named on its own because it is the one attention key a run does not end:
 * it asks the owner to put a schedule back, which no run answers.
 */
export const TASK_SCHEDULE_REMOVED_MESSAGE_KEY =
  "Notifications.Task.scheduleRemovedByOperator";

/**
 * The task keys that wait on the reader.
 *
 * A task that needs input, approval, authentication or credits stops until the
 * reader acts. Everything else a task emits is an outcome they can read later,
 * so each is a row of its own and the loud one can stay on while the quiet ones
 * go off. A key added later is an update until it is listed here, which is the
 * safe way round: an unknown key is never louder than the reader asked for.
 */
export const TASK_ATTENTION_MESSAGE_KEYS: readonly string[] = [
  "Notifications.Task.assigned",
  TASK_INPUT_REQUIRED_MESSAGE_KEY,
  "Notifications.Task.approvalRequired",
  "Notifications.Task.authenticationRequired",
  "Notifications.Task.outOfCredits",
  TASK_SCHEDULE_REMOVED_MESSAGE_KEY,
];

/**
 * The key a finished task carries.
 *
 * Its own row rather than an update, because finishing is what the reader
 * started the task for. Grouped with the cancellations, it could only be kept
 * by keeping them too.
 */
export const TASK_COMPLETED_MESSAGE_KEY = "Notifications.Task.completed";

/**
 * The task keys that mean the task has stopped waiting on anybody (SOK-916).
 *
 * A task that completed, failed or was canceled is settled, however it got
 * there and whoever got it there. The reader may have done none of it: a
 * teammate cancels, a run fails on its own. So the attention row the task left
 * behind is now about a question nobody is asking, and user stories 14 and 15
 * say they should not be reminded of it.
 *
 * Kept next to the attention list rather than at the seam that reads it, so
 * the two halves of one taxonomy sit together and a key added to one is seen
 * next to the other.
 */
export const TASK_TERMINAL_MESSAGE_KEYS: readonly string[] = [
  TASK_COMPLETED_MESSAGE_KEY,
  "Notifications.Task.failed",
  "Notifications.Task.canceled",
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
  /**
   * The reader's inbox (SOK-916).
   *
   * Only ever true for a category that sends email at all, which today is
   * follow-ups alone (`NOTIFICATION_EMAIL_CATEGORIES`). Every other category
   * has no email to send, so the answer here is no rather than unasked.
   *
   * Unlike the banner there is no account-wide consent gating this. The
   * address is already the one the account signs in with, and the row in the
   * matrix is the reader's say over it.
   */
  email: boolean;
  /**
   * Set only when the reader's preferences would not read and this is a guess.
   *
   * The guess suits a caller that was going to write either way and only
   * wants to know about the banner. It does not suit a caller for whom this
   * answer decides whether to write at all: there it says yes on behalf of a
   * reader who may have said no. Such a caller reads this and skips instead.
   */
  fellBack?: true;
}

/**
 * The matrix row a Notification belongs to, or null when it belongs to none.
 *
 * Every kind splits by message key, because a reader chooses between an
 * @mention and a direct message, or between a task that waits on them, a task
 * that finished and a task that was canceled, rather than between the kinds a
 * producer happens to emit.
 *
 * Null means the defaults apply and nothing is stored against it: a chat key
 * added later that nobody mapped, BILLING, which no producer emits yet, and
 * JOB, which no producer emits any more (SOK-930). A row would be a switch
 * that controls nothing, so there is none.
 *
 * Follow-ups are the one exception to the split-by-key rule, and they break it
 * in the other direction: every follow-up key, whatever its kind, answers to
 * the single `FOLLOW_UP` row. Which keys those are is
 * `isFollowUpMessageKey` in `@sokosumi/utils`.
 */
export function toNotificationCategory(
  kind: NotificationKind,
  messageKey: string,
): NotificationCategory | null {
  // Asked before the kind, because a follow-up exists for three of them and
  // the reader decides about reminders once rather than once per kind.
  if (isFollowUpMessageKey(messageKey)) {
    return "FOLLOW_UP";
  }

  switch (kind) {
    case "TASK":
      if (TASK_ATTENTION_MESSAGE_KEYS.includes(messageKey)) {
        return "TASK_ATTENTION";
      }
      return messageKey === TASK_COMPLETED_MESSAGE_KEY
        ? "TASK_COMPLETED"
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
      if (messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY) {
        return "CHAT_ROOM_MESSAGE";
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

  return stored?.enabled ?? notificationDefault(category, channel);
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
    // Gated on the category the way the banner is gated on the account-wide
    // consent: a category that sends no email has none to send however the
    // stored row reads. The preferences route does not refuse such a row, and
    // a reader could hold one from a build where the category did email, so
    // the gate is here rather than trusted to the absence of the row.
    email:
      category !== null &&
      NOTIFICATION_EMAIL_CATEGORIES.includes(category) &&
      isEnabled(category, "EMAIL", preferences),
  };
}

/** One cell of the matrix the reader sees, with its answer already resolved. */
export interface NotificationMatrixCell {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
}

/**
 * The whole matrix, one cell per category and channel the reader can decide.
 *
 * Complete rather than sparse, so the reader's settings page renders what it
 * is given and the defaults stay in one place. A stored row that names a
 * category or a channel this build does not know belongs to no cell and is
 * dropped.
 *
 * With one hole in it, and on purpose: a category that sends no email has no
 * email cell (SOK-916). The settings page draws the cells it is handed, so
 * this is what stops it drawing eight switches that control nothing. A stored
 * `EMAIL` row for such a category, which the preferences route does not refuse,
 * is dropped here along with the cell, because nothing would read it.
 */
export function resolveNotificationMatrix(
  preferences: readonly StoredNotificationPreference[],
): NotificationMatrixCell[] {
  return NOTIFICATION_CATEGORIES.flatMap((category) =>
    NOTIFICATION_CHANNELS.filter(
      (channel) =>
        channel !== "EMAIL" || NOTIFICATION_EMAIL_CATEGORIES.includes(category),
    ).map((channel) => ({
      category,
      channel,
      enabled: isEnabled(category, channel, preferences),
    })),
  );
}
