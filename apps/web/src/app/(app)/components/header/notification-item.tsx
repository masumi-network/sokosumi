"use client";

import { Bell } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useNotificationMessage } from "@/lib/utils/notification-message";

interface NotificationItemProps {
  notification: NotificationItem;
  onClick: () => void;
  formatTime: (timestamp: string | Date) => string;
}

export function NotificationItem({
  notification,
  onClick,
  formatTime,
}: NotificationItemProps) {
  const formatMessage = useNotificationMessage();
  const message = formatMessage(
    notification.messageKey,
    notification.messageParams ?? {},
  );

  return (
    <DropdownMenuItem
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 px-4 py-3",
        !notification.isRead && "bg-accent/50",
      )}
      onClick={onClick}
    >
      <div className="flex w-full items-start gap-3">
        <Bell
          className={cn(
            "mt-0.5 size-4 shrink-0",
            notification.isRead ? "text-muted-foreground" : "text-primary",
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={cn("text-sm", !notification.isRead && "font-medium")}>
            {message}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatTime(notification.createdAt)}
          </p>
        </div>
      </div>
    </DropdownMenuItem>
  );
}
