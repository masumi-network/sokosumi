"use client";

import type { SessionUser } from "@sokosumi/utils";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccountNotice } from "@/contexts/account-notice-provider";
import { useNotifications } from "@/contexts/notification-provider";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import HeaderWorkspaceAvatar from "./header-workspace-avatar";
import { NotificationDropdownContent } from "./notification-dropdown-content";

interface HeaderNotificationAvatarProps {
  sessionUser: SessionUser;
  organization?: OrganizationRecord | null;
}

const REMINDER_INTERVAL = 3 * 60 * 1000; // 3 minutes
const SLIDE_DURATION_MS = 550;
const BELL_RING_DELAY_MS = 600;
const BELL_RING_CYCLE_MS = 1100;
const BELL_RING_REPEATS = 2;
const ANIMATION_DURATION =
  SLIDE_DURATION_MS +
  BELL_RING_DELAY_MS +
  BELL_RING_CYCLE_MS * BELL_RING_REPEATS +
  SLIDE_DURATION_MS;

function getIndicatorDotClassName(
  hasAccountNotice: boolean,
  accountNoticeTone: "warning" | "destructive" | undefined,
): string {
  if (hasAccountNotice) {
    return accountNoticeTone === "destructive"
      ? "bg-semantic-destructive"
      : "bg-semantic-warning";
  }

  return "bg-primary";
}

function getBellPanelClassName(
  accountNoticeTone: "warning" | "destructive" | undefined,
): string {
  if (accountNoticeTone === "destructive") {
    return "notification-reminder-bell-panel-destructive";
  }

  if (accountNoticeTone === "warning") {
    return "notification-reminder-bell-panel-warning";
  }

  return "notification-reminder-bell-panel-primary";
}

export function HeaderNotificationAvatar({
  sessionUser,
  organization,
}: HeaderNotificationAvatarProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { unreadCount } = useNotifications();
  const { notice } = useAccountNotice();
  const [isOpen, setIsOpen] = useState(false);
  const [showBell, setShowBell] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const bellAnimationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasAccountNotice = notice !== null;
  const hasIndicator = unreadCount > 0 || hasAccountNotice;

  useEffect(() => {
    const stopBellAnimation = () => {
      if (bellAnimationTimeoutRef.current !== null) {
        clearTimeout(bellAnimationTimeoutRef.current);
        bellAnimationTimeoutRef.current = null;
      }
      setShowBell(false);
      setIsAnimating(false);
    };

    if (!hasIndicator || isOpen) {
      stopBellAnimation();
      return;
    }

    const checkPrefersReducedMotion = () => {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    };

    const triggerBellAnimation = () => {
      if (document.hidden || checkPrefersReducedMotion()) {
        return;
      }

      if (bellAnimationTimeoutRef.current !== null) {
        clearTimeout(bellAnimationTimeoutRef.current);
        bellAnimationTimeoutRef.current = null;
      }

      setIsAnimating(true);
      setShowBell(true);

      bellAnimationTimeoutRef.current = setTimeout(() => {
        bellAnimationTimeoutRef.current = null;
        setShowBell(false);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    };

    const intervalId = setInterval(triggerBellAnimation, REMINDER_INTERVAL);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        triggerBellAnimation();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopBellAnimation();
    };
  }, [hasIndicator, isOpen]);

  const ariaLabel =
    unreadCount > 0 && hasAccountNotice
      ? t("unreadBadgeWithAccountNotice", { count: unreadCount })
      : unreadCount > 0
        ? t("unreadBadge", { count: unreadCount })
        : hasAccountNotice
          ? t("accountNoticeIndicator")
          : t("notifications");

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:opacity-80 relative flex shrink-0 items-center transition-opacity"
          aria-label={ariaLabel}
        >
          <div
            className={cn(
              "relative size-8 overflow-hidden rounded-full",
              showBell && "notification-reminder-bell-active",
            )}
          >
            <div
              className="notification-reminder-avatar-panel absolute inset-0"
              aria-hidden={showBell}
            >
              <HeaderWorkspaceAvatar
                sessionUser={sessionUser}
                organization={organization ?? null}
              />
            </div>
            <div
              className={cn(
                "notification-reminder-bell-panel absolute inset-0 flex items-center justify-center",
                getBellPanelClassName(notice?.tone),
              )}
              aria-hidden={!showBell}
            >
              <Bell
                className={cn(
                  "size-4",
                  isAnimating && "animate-notification-bell-ring",
                )}
              />
            </div>
          </div>
          {hasIndicator && !showBell ? (
            <span
              className={cn(
                "absolute right-0 top-0 size-2 animate-pulse rounded-full ring-2 ring-background",
                getIndicatorDotClassName(hasAccountNotice, notice?.tone),
              )}
              aria-hidden
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn("w-96", unreadCount === 0 && "w-80")}
        align="end"
      >
        <NotificationDropdownContent onClose={() => setIsOpen(false)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
