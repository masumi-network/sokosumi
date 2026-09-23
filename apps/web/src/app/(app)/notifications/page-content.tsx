"use client";

import { Loader2 } from "lucide-react";
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
 * adds its heading and the card around it, and nothing else.
 */
export function NotificationsPageContent() {
  const t = useTranslations("Components.NotificationCenter");
  const { notice } = useAccountNotice();
  const { notifications, view } = useNotifications();
  const { unreadCount, isMarkingAllRead, handleMarkAllRead } = useMarkAllRead();

  return (
    <div className="flex flex-col gap-5 pb-4">
      {/* The heading comes first, before anything the page has to say. A
          notice or a push primer above it pushed the page's own title into
          the middle of the screen, so the first thing a reader met was an
          aside about a setting. Mark all read rides on the heading row: the
          button outlives the last unread row, and a row of its own would
          collapse under the reader's pointer the moment that row was
          read. */}
      <div
        data-testid="notifications-page-header"
        className="flex flex-wrap items-start justify-between gap-3"
      >
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("pageTitle")}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            {t("pageDescription")}
          </p>
        </div>
        {/* Outline, not filled: a filled button marks the one primary action
            of a view, and clearing state in bulk is not it. */}
        {unreadCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleMarkAllRead}
            disabled={isMarkingAllRead}
            aria-busy={isMarkingAllRead}
          >
            {/* The label stays put while the request runs. Swapping it for
                "Loading..." takes away the only words that said what the
                button does. */}
            {isMarkingAllRead ? (
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : null}
            {t("markAllRead")}
          </Button>
        ) : null}
      </div>
      {notice !== null ? <AccountNoticeRow /> : null}
      <NotificationBrowserPermissionPrimer variant="page" />
      {/* The strip is the card's top edge, so it reads as this card's own
          control and not as page navigation. The card stays out only when
          the list has nothing to say under an account notice, and then
          there is nothing to narrow either. */}
      {notifications.length > 0 || view !== "all" || notice === null ? (
        <div
          data-notification-frame=""
          className="bg-card-background border-border overflow-hidden rounded-xl border"
        >
          <NotificationCenterViewFilter />
          <NotificationCenterList />
        </div>
      ) : null}
    </div>
  );
}
