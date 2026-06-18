"use client";

import { Bell } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNotifications } from "@/contexts/notification-provider";
import { cn } from "@/lib/utils";

import { NotificationDropdownContent } from "./notification-dropdown-content";

export function HeaderNotificationBell() {
  const t = useTranslations("Components.NotificationCenter");
  const { unreadCount } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:bg-accent hover:text-accent-foreground relative flex size-8 shrink-0 items-center justify-center rounded-md transition-colors"
          aria-label={t("notifications")}
        >
          <Bell className="size-5" aria-hidden />
          {unreadCount > 0 ? (
            <span
              className="bg-green-500 absolute right-0.5 top-0.5 size-2 rounded-full"
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
