"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { NotificationCenterList } from "@/components/notifications/notification-center-list";
import { NotificationCenterViewFilter } from "@/components/notifications/notification-center-view-filter";
import { useMarkAllRead } from "@/components/notifications/use-mark-all-read";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAccountNotice } from "@/contexts/account-notice-provider";

interface NotificationPanelContentProps {
  onClose: () => void;
}

/**
 * What the header bell opens on desktop: the Notification Center's list, with
 * the panel's own chrome around it.
 *
 * A popover rather than a menu. The list grows as the reader scrolls, each row
 * carries its own button, and a menu's roving focus fights both of those: it
 * owns the arrow keys and expects a fixed set of items.
 */
export function NotificationPanelContent({
  onClose,
}: NotificationPanelContentProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { notice } = useAccountNotice();
  const { unreadCount, isMarkingAllRead, handleMarkAllRead } = useMarkAllRead();

  return (
    <>
      {notice !== null ? (
        <>
          <AccountNoticeRow variant="panel" onActionComplete={onClose} />
          <Separator />
        </>
      ) : null}
      {/* Title and the Unread lens, and nothing that comes and goes: the
          chip is anchored to the right edge and never moves. Mark all read
          lives in the footer, where it shares a row with the link to the
          page. The popover's own 16px inset carries on here, so the title,
          the primer, and the chip's outer edge share one line. */}
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="text-sm font-medium">{t("title")}</p>
        <NotificationCenterViewFilter />
      </div>
      <Separator />
      <NotificationBrowserPermissionPrimer
        className="mx-4 my-3"
        onNavigate={onClose}
      />
      {/* The scroll container the boundary row watches: reaching the end of
          it is what asks for the page of older rows. It carries the line
          under it, so when the list has nothing to say under an account
          notice, the box and its line leave together. */}
      <div className="max-h-96 overflow-y-auto border-b empty:hidden">
        <NotificationCenterList onNavigate={onClose} />
      </div>
      {/* Mark all read on the left, the page on the right. The left
          button leaves with the last unread row; the link is pinned to
          the right edge, so nothing moves when it does. The ghost buttons'
          own padding puts their labels on the header's 16px line. */}
      <div className="flex items-center gap-2 px-1 py-2">
        {unreadCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleMarkAllRead}
            disabled={isMarkingAllRead}
          >
            {isMarkingAllRead ? t("loading") : t("markAllRead")}
          </Button>
        ) : null}
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground ml-auto"
        >
          <Link href="/notifications" onClick={onClose}>
            {t("viewAll")}
          </Link>
        </Button>
      </div>
    </>
  );
}
