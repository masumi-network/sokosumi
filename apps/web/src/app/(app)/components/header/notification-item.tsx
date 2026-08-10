"use client";

import { Bell } from "lucide-react";
import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { VendorGrantNotificationActions } from "@/components/notifications/vendor-grant-notification-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type { NotificationItem as NotificationItemType } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { isPendingCoworkerAccessNotification } from "@/lib/utils/coworker-access-notification";
import { useNotificationMessage } from "@/lib/utils/notification-message";
import { isPendingVendorGrantNotification } from "@/lib/utils/vendor-grant-notification";

interface NotificationItemProps {
  notification: NotificationItemType;
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
  const showVendorGrantActions = isPendingVendorGrantNotification(notification);
  const showCoworkerAccessActions =
    isPendingCoworkerAccessNotification(notification);
  const showPendingAccessActions =
    showVendorGrantActions || showCoworkerAccessActions;

  const itemClassName = cn(
    "flex cursor-pointer flex-col items-start gap-1 px-4 py-3",
    !notification.isRead && "bg-accent/50",
    showPendingAccessActions && "cursor-default",
  );

  const body = (
    <div className="flex w-full items-start gap-3">
      <Bell
        className={cn(
          "mt-0.5 size-4 shrink-0",
          notification.isRead ? "text-muted-foreground" : "text-primary",
        )}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {showPendingAccessActions ? (
          <button
            type="button"
            className="hover:bg-accent/50 -mx-1 cursor-pointer rounded-md px-1 text-left"
            onClick={onClick}
          >
            <p className={cn("text-sm", !notification.isRead && "font-medium")}>
              {message}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatTime(notification.createdAt)}
            </p>
          </button>
        ) : (
          <>
            <p className={cn("text-sm", !notification.isRead && "font-medium")}>
              {message}
            </p>
            <p className="text-muted-foreground text-xs">
              {formatTime(notification.createdAt)}
            </p>
          </>
        )}
        {showVendorGrantActions ? (
          <VendorGrantNotificationActions
            notification={notification}
            layout="inline"
          />
        ) : null}
        {showCoworkerAccessActions ? (
          <CoworkerAccessNotificationActions
            notification={notification}
            layout="inline"
          />
        ) : null}
      </div>
    </div>
  );

  if (showPendingAccessActions) {
    return (
      <DropdownMenuItem
        className={itemClassName}
        onSelect={(event) => event.preventDefault()}
      >
        {body}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem className={itemClassName} onClick={onClick}>
      {body}
    </DropdownMenuItem>
  );
}
