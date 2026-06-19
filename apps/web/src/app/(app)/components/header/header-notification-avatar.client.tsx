"use client";

import type { SessionUser } from "@sokosumi/utils";
import { useTranslations } from "next-intl";
import { useState } from "react";
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

export function HeaderNotificationAvatar({
  sessionUser,
  organization,
}: HeaderNotificationAvatarProps) {
  const t = useTranslations("Components.NotificationCenter");
  const { unreadCount } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="hover:opacity-80 relative flex shrink-0 items-center transition-opacity"
          aria-label={t("notifications")}
        >
          <HeaderWorkspaceAvatar
            sessionUser={sessionUser}
            organization={organization ?? null}
          />
          {unreadCount > 0 ? (
            <span
              className="bg-green-500 absolute right-0 top-0 size-2 rounded-full ring-2 ring-background"
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
