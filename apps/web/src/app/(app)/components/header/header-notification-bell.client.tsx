"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { CornerCountBadge } from "@/components/common/corner-count-badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  getNotificationIndicator,
  getNotificationIndicatorClassName,
} from "./notification-indicator";
import { NotificationPanelContent } from "./notification-panel-content";

export function HeaderNotificationBell() {
  const t = useTranslations("Components.NotificationCenter");
  const { unreadCount } = useNotifications();
  const { notice } = useAccountNotice();
  const isMobile = useIsMobile();
  const [isOpen, setIsOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const hasAccountNotice = notice !== null;
  const indicator = getNotificationIndicator(
    unreadCount,
    hasAccountNotice,
    notice?.tone,
  );

  // Reading a row is the reader's move, not the panel's. Closing the bell
  // writes nothing: each row carries its own mark read control, and the
  // header still offers mark all as read.
  function closeBell() {
    setIsOpen(false);
  }

  const ariaLabel =
    unreadCount > 0 && hasAccountNotice
      ? t("unreadBadgeWithAccountNotice", { count: unreadCount })
      : unreadCount > 0
        ? t("unreadBadge", { count: unreadCount })
        : hasAccountNotice
          ? t("accountNoticeIndicator")
          : t("notifications");

  const buttonClassName =
    "hover:bg-muted relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors";

  const bellFace = (
    <>
      <Bell className="text-foreground size-4" aria-hidden />
      {indicator?.kind === "count" ? (
        <CornerCountBadge
          data-testid="notification-unread-badge"
          className={getNotificationIndicatorClassName(indicator.tone)}
        >
          {indicator.value}
        </CornerCountBadge>
      ) : null}
      {indicator?.kind === "dot" ? (
        <span
          data-testid="notification-account-notice-dot"
          className={cn(
            "absolute top-0 right-0 size-2 rounded-full ring-2 ring-background",
            getNotificationIndicatorClassName(indicator.tone),
          )}
          aria-hidden
        />
      ) : null}
    </>
  );

  // On a phone the list gets the whole screen instead of a panel hanging off
  // the header: the page is the same list, and a 24rem popover on a 20rem
  // viewport is the list through a letterbox.
  if (isMobile) {
    return (
      <Link
        href="/notifications"
        className={buttonClassName}
        aria-label={ariaLabel}
      >
        {bellFace}
      </Link>
    );
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          setIsTooltipOpen(false);
        }
      }}
    >
      <Tooltip
        open={isOpen ? false : isTooltipOpen}
        onOpenChange={(open) => {
          if (!isOpen) {
            setIsTooltipOpen(open);
          }
        }}
      >
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={buttonClassName}
              aria-label={ariaLabel}
            >
              {bellFace}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {t("notifications")}
        </TooltipContent>
      </Tooltip>
      {/* One width, whatever the unread count is. The panel used to narrow
          the moment the count reached zero, and now that each row carries
          its own mark read control the reader watches that happen under
          their cursor. The cap keeps that one width inside a narrow
          viewport, where 24rem is wider than the screen. */}
      <PopoverContent
        data-notification-frame=""
        className="w-96 max-w-(--radix-popover-content-available-width) p-0"
        align="end"
        onOpenAutoFocus={(event) => {
          // Focus the panel, not its first control. The popover would pick
          // the first row, and a row with focus inside shows its read
          // control, so every open singled out a row the reader had not
          // touched. Tab still reaches the rows from here.
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) {
            event.currentTarget.focus();
          }
        }}
      >
        <NotificationPanelContent onClose={closeBell} />
      </PopoverContent>
    </Popover>
  );
}
