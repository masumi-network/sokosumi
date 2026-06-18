"use client";

import { useTranslations } from "next-intl";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { components } from "@/lib/clients/generated/core/types";
import { cn } from "@/lib/utils";

type NotificationItem = components["schemas"]["NotificationItem"];

interface NotificationItemProps {
  notification: NotificationItem;
  onClick: () => void;
  formatTime: (timestamp: string) => string;
}

export function NotificationItem({
  notification,
  onClick,
  formatTime,
}: NotificationItemProps) {
  const t = useTranslations("Notifications");

  const messageKey = notification.messageKey;
  const messageParams = notification.messageParams ?? {};

  let message: string;
  try {
    message = t(messageKey as never, messageParams as never);
  } catch {
    message = messageKey;
  }

  return (
    <DropdownMenuItem
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 px-4 py-3",
        !notification.isRead && "bg-accent/50",
      )}
      onClick={onClick}
    >
      <div className="flex w-full items-start justify-between gap-2">
        <p className={cn("text-sm", !notification.isRead && "font-medium")}>
          {message}
        </p>
        {!notification.isRead ? (
          <span className="bg-green-500 mt-1.5 size-2 shrink-0 rounded-full" />
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        {formatTime(notification.createdAt)}
      </p>
    </DropdownMenuItem>
  );
}
