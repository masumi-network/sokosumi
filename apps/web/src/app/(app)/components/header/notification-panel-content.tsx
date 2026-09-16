"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { NotificationCenterList } from "@/components/notifications/notification-center-list";
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
      {/* One height with or without Mark all as read, which is taller than
          the title. The header used to grow and shrink as the last unread
          row changed, and move the whole list with it. */}
      <div className="flex min-h-9 items-center justify-between gap-2 py-1.5 pr-1 pl-3">
        <p className="text-sm font-medium">{t("title")}</p>
        {unreadCount > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground h-auto px-2 py-1 text-xs font-normal"
            onClick={handleMarkAllRead}
            disabled={isMarkingAllRead}
          >
            {isMarkingAllRead ? t("loading") : t("markAllRead")}
          </Button>
        ) : null}
      </div>
      <Separator />
      <NotificationBrowserPermissionPrimer
        className="mx-2 my-2"
        onNavigate={onClose}
      />
      {/* The scroll container the boundary row watches: reaching the end of
          it is what asks for the page of older rows. It carries the line
          under it, so when the list has nothing to say under an account
          notice, the box and its line leave together. */}
      <div className="max-h-96 overflow-y-auto border-b empty:hidden">
        <NotificationCenterList onNavigate={onClose} />
      </div>
      <div className="p-2">
        <Button asChild variant="ghost" className="w-full" size="sm">
          <Link href="/notifications" onClick={onClose}>
            {t("viewAll")}
          </Link>
        </Button>
      </div>
    </>
  );
}
