"use client";

import { useTranslations } from "next-intl";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { NotificationCenterList } from "@/components/notifications/notification-center-list";
import { useMarkAllRead } from "@/components/notifications/use-mark-all-read";
import { Button } from "@/components/ui/button";
import { useAccountNotice } from "@/contexts/account-notice-provider";

/**
 * The Notification Center at full width, and the only frame it has on a
 * phone. The same list as the header panel, over the same state: the page
 * adds the card around it and mark all as read above it, and nothing else.
 */
export function NotificationsPageContent() {
  const t = useTranslations("Components.NotificationCenter");
  const { notice } = useAccountNotice();
  const { unreadCount, isMarkingAllRead, handleMarkAllRead } = useMarkAllRead();

  return (
    <div className="flex flex-col gap-5 pb-4">
      {notice !== null ? <AccountNoticeRow /> : null}
      <NotificationBrowserPermissionPrimer variant="page" />
      {unreadCount > 0 ? (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            className="self-start"
            onClick={handleMarkAllRead}
            disabled={isMarkingAllRead}
          >
            {isMarkingAllRead ? t("loading") : t("markAllRead")}
          </Button>
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
