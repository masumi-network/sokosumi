export const UNREAD_BADGE_CAP = 9;

export type NotificationIndicatorTone = "primary" | "warning" | "destructive";

export type NotificationIndicator =
  | {
      kind: "count";
      value: string;
      tone: NotificationIndicatorTone;
    }
  | {
      kind: "dot";
      tone: NotificationIndicatorTone;
    };

export function formatUnreadBadgeCount(count: number): string {
  if (count > UNREAD_BADGE_CAP) {
    return `${UNREAD_BADGE_CAP}+`;
  }

  return String(count);
}

function resolveTone(
  hasAccountNotice: boolean,
  accountNoticeTone: "warning" | "destructive" | undefined,
): NotificationIndicatorTone {
  if (!hasAccountNotice) {
    return "primary";
  }

  return accountNoticeTone === "destructive" ? "destructive" : "warning";
}

/**
 * Closed-state badge for the notification bell.
 * - Unread: numeric count (capped), optionally tinted by account notice.
 * - Notice only: tone-colored dot (never a fake count of 1).
 */
export function getNotificationIndicator(
  unreadCount: number,
  hasAccountNotice: boolean,
  accountNoticeTone?: "warning" | "destructive",
): NotificationIndicator | null {
  const tone = resolveTone(hasAccountNotice, accountNoticeTone);

  if (unreadCount > 0) {
    return {
      kind: "count",
      value: formatUnreadBadgeCount(unreadCount),
      tone,
    };
  }

  if (hasAccountNotice) {
    return { kind: "dot", tone };
  }

  return null;
}

export function getNotificationIndicatorClassName(
  tone: NotificationIndicatorTone,
): string {
  if (tone === "destructive") {
    // The solid, not the text red. --semantic-destructive is the value that
    // reads as text on the page; in dark mode a near-white count on it
    // measures 3.43:1. --semantic-destructive-solid is the fill half of the
    // same split and measures 4.91:1.
    return "bg-semantic-destructive-solid text-semantic-destructive-foreground";
  }

  if (tone === "warning") {
    return "bg-semantic-warning text-semantic-warning-foreground";
  }

  return "bg-primary text-primary-foreground";
}
