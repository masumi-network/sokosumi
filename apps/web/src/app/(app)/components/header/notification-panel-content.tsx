"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { NotificationNeedsYouRequests } from "@/app/components/notification-needs-you-requests";
import { NotificationCenterList } from "@/components/notifications/notification-center-list";
import { NotificationCenterViewFilter } from "@/components/notifications/notification-center-view-filter";
import { useMarkAllRead } from "@/components/notifications/use-mark-all-read";
import { Button } from "@/components/ui/button";

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
  const { unreadCount, isMarkingAllRead, handleMarkAllRead } = useMarkAllRead();

  return (
    <>
      {/* One height with or without Mark all read, which is taller than
          the title. The header used to grow and shrink as the last unread
          row changed, and move the whole list with it. Nothing else shares
          the row, so the button can leave without moving a thing. The
          popover's own 16px inset carries on here, so the title, the
          strip, and the button's outer edge share one line. */}
      <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
        {/* A heading, not a paragraph, and the page's own tracking on it.
            The two frames list the same rows, so the panel names them the
            way the page does, one level down. */}
        <h2 className="text-base font-semibold tracking-tight">{t("title")}</h2>
        {unreadCount > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isMarkingAllRead}
            aria-busy={isMarkingAllRead}
          >
            {/* The label stays put while the request runs, the same as the
                page's button: "Loading..." took away the only words that
                said what this button does. */}
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
      {/* The strip carries the line under it, so it stands in for the
          separator between the header and the list. */}
      <NotificationCenterViewFilter />
      <NotificationNeedsYouRequests variant="panel" onNavigate={onClose} />
      {/* The scroll container the boundary row watches: reaching the end of
          it is what asks for the page of older rows. It carries the line
          under it, so when the list has nothing to say under an account
          notice, the box and its line leave together. */}
      <div className="max-h-96 overflow-y-auto border-b empty:hidden">
        <NotificationCenterList onNavigate={onClose} />
      </div>
      <div className="p-2">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground w-full"
        >
          <Link href="/notifications" onClick={onClose}>
            {t("viewAll")}
          </Link>
        </Button>
      </div>
    </>
  );
}
