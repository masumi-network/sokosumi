"use client";

import type { SessionUser } from "@sokosumi/utils";
import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/contexts/notification-provider";
import type { OrganizationRecord } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

import HeaderWorkspaceAvatar from "./header-workspace-avatar";
import { NotificationDropdownContent } from "./notification-dropdown-content";

interface HeaderNotificationAvatarProps {
  sessionUser: SessionUser;
  organization?: OrganizationRecord | null;
}

const REMINDER_INTERVAL = 5 * 60 * 1000; // 5 minutes
const ANIMATION_DURATION = 3000; // 3 seconds for morph + shake + morph back

export function HeaderNotificationAvatar({
  sessionUser,
  organization,
}: HeaderNotificationAvatarProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { unreadCount } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const [showBell, setShowBell] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (unreadCount === 0 || isOpen) {
      return;
    }

    const checkPrefersReducedMotion = () => {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    };

    const triggerBellAnimation = () => {
      if (document.hidden || checkPrefersReducedMotion()) {
        return;
      }

      setIsAnimating(true);
      setShowBell(true);

      setTimeout(() => {
        setShowBell(false);
        setIsAnimating(false);
      }, ANIMATION_DURATION);
    };

    const intervalId = setInterval(triggerBellAnimation, REMINDER_INTERVAL);

    return () => {
      clearInterval(intervalId);
    };
  }, [unreadCount, isOpen]);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:opacity-80 relative flex shrink-0 items-center transition-opacity"
          aria-label={t("notifications")}
        >
          <div className="relative size-8">
            {showBell ? (
              <div
                className={cn(
                  "bg-primary text-primary-foreground flex size-full items-center justify-center rounded-full transition-all",
                  isAnimating && "animate-[shake_0.5s_ease-in-out_0.5s]",
                )}
              >
                <Bell className="size-4" />
              </div>
            ) : (
              <HeaderWorkspaceAvatar
                sessionUser={sessionUser}
                organization={organization ?? null}
              />
            )}
          </div>
          {unreadCount > 0 ? (
            <span
              className="bg-primary absolute right-0 top-0 size-2 animate-pulse rounded-full ring-2 ring-background"
              aria-label={t("unreadBadge", { count: unreadCount })}
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
