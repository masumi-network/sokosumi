"use client";

import { useTranslations } from "next-intl";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { NotificationCenterList } from "@/components/notifications/notification-center-list";
import { NotificationCenterViewFilter } from "@/components/notifications/notification-center-view-filter";
import { useMarkAllRead } from "@/components/notifications/use-mark-all-read";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";

/**
 * The Notification Center at full width, and the only frame it has on a
 * phone. The same list as the header panel, over the same state: the page
 * adds the card around it and mark all as read above it, and nothing else.
 */
export function NotificationsPageContent() {
  const t = useTranslations("Components.NotificationCenter");
  const { notice } = useAccountNotice();
  const { notifications, view } = useNotifications();
  const { unreadCount, isMarkingAllRead, handleMarkAllRead } = useMarkAllRead();

  return (
    <div className="flex flex-col gap-5 pb-4">
      {notice !== null ? <AccountNoticeRow /> : null}
      <NotificationBrowserPermissionPrimer variant="page" />
      {/* The row outlives its button. Reading the last unread row takes the
          button away, and a row that went with it would pull the whole list
          up under the reader's pointer. It also outlives the rows in the
          Unread view, so the reader can always switch back from an empty
          narrowed list. */}
      {notifications.length > 0 || view === "unread" ? (
        <div
          data-testid="notifications-page-actions"
          className="flex min-h-8 items-center justify-end gap-1.5"
        >
          <NotificationCenterViewFilter />
          {unreadCount > 0 ? (
            <Button
              type="button"
              size="sm"
              onClick={handleMarkAllRead}
              disabled={isMarkingAllRead}
            >
              {isMarkingAllRead ? t("loading") : t("markAllRead")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* Empty only when the list has nothing to say under an account notice,
          and then there is no card to draw either. */}
      <div className="bg-muted/30 border-border/50 overflow-hidden rounded-xl border empty:hidden">
        <NotificationCenterList />
      </div>
    </div>
  );
}
