"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import { cn } from "@/lib/utils";
import { NotificationDropdownContent } from "./notification-dropdown-content";
import {
  getNotificationIndicator,
  getNotificationIndicatorClassName,
} from "./notification-indicator";

export function HeaderNotificationBell() {
  const t = useTranslations("Components.NotificationCenter");
  const { unreadCount } = useNotifications();
  const { notice } = useAccountNotice();
  const [isOpen, setIsOpen] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const hasAccountNotice = notice !== null;
  const indicator = getNotificationIndicator(
    unreadCount,
    hasAccountNotice,
    notice?.tone,
  );

  const ariaLabel =
    unreadCount > 0 && hasAccountNotice
      ? t("unreadBadgeWithAccountNotice", { count: unreadCount })
      : unreadCount > 0
        ? t("unreadBadge", { count: unreadCount })
        : hasAccountNotice
          ? t("accountNoticeIndicator")
          : t("notifications");

  return (
    <DropdownMenu
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
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="hover:bg-muted relative flex size-8 shrink-0 items-center justify-center rounded-full transition-colors"
              aria-label={ariaLabel}
            >
              <Bell className="text-foreground size-4" aria-hidden />
              {indicator?.kind === "count" ? (
                <span
                  data-testid="notification-unread-badge"
                  className={cn(
                    "absolute -top-0.5 -right-0.5 inline-flex min-w-4.5 items-center justify-center rounded-full px-0.5 text-[10px] leading-4 font-semibold tabular-nums ring-2 ring-background",
                    getNotificationIndicatorClassName(indicator.tone),
                  )}
                  aria-hidden
                >
                  {indicator.value}
                </span>
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
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {t("notifications")}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className={cn("w-96", unreadCount === 0 && "w-80")}
        align="end"
      >
        <NotificationDropdownContent onClose={() => setIsOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
