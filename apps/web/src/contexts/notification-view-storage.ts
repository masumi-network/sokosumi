import type { NotificationCenterView } from "./notification-state";

/**
 * The reader's last chosen view, kept per browser.
 *
 * A lens, not account data: it never leaves the browser, and every failure
 * path resolves to the widest view rather than to an empty list. The key
 * carries its version, so a change to the view vocabulary retires the old
 * value instead of misreading it.
 */
export const NOTIFICATION_VIEW_STORAGE_KEY =
  "sokosumi:notification-center-view:v1" as const;

const VIEWS: readonly NotificationCenterView[] = [
  "all",
  "unread",
  "needs-action",
];

function isView(value: string): value is NotificationCenterView {
  return VIEWS.some((view) => view === value);
}

export function getNotificationViewPreference(): NotificationCenterView | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(NOTIFICATION_VIEW_STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    if (isView(raw)) {
      return raw;
    }
    window.localStorage.removeItem(NOTIFICATION_VIEW_STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

export function setNotificationViewPreference(
  view: NotificationCenterView,
): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(NOTIFICATION_VIEW_STORAGE_KEY, view);
  } catch {
    // Best-effort: quota or private mode must not break the feed.
  }
}
