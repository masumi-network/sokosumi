import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/utils/preference-storage";
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

// A record, not a list: a fourth view has to be named here or the type check
// fails, which is the only thing stopping a new view from silently failing
// to restore.
const VIEWS: Record<NotificationCenterView, true> = {
  all: true,
  unread: true,
  "needs-action": true,
};

function isView(raw: string): raw is NotificationCenterView {
  return Object.hasOwn(VIEWS, raw);
}

export function getNotificationViewPreference(): NotificationCenterView | null {
  return readStoredPreference(NOTIFICATION_VIEW_STORAGE_KEY, (raw) =>
    isView(raw) ? raw : null,
  );
}

export function setNotificationViewPreference(
  view: NotificationCenterView,
): void {
  writeStoredPreference(NOTIFICATION_VIEW_STORAGE_KEY, view);
}
