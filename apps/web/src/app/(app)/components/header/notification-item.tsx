"use client";

import { Bell } from "lucide-react";
import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { DeleteNotificationMenuItem } from "@/components/notifications/delete-notification-menu-item";
import { VendorGrantNotificationActions } from "@/components/notifications/vendor-grant-notification-actions";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
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

  const rowClassName = cn(
    "flex w-full items-start",
    !notification.isRead && "bg-accent/50",
  );

  const itemClassName = cn(
    "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 py-3 pr-1 pl-4",
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

  // The delete control is a menu item beside the row rather than inside it,
  // so arrow keys reach it and the row item keeps one role.
  const deleteControl = (
    <DeleteNotificationMenuItem
      notificationId={notification.id}
      notificationMessage={message}
    />
  );

  // A group rather than a plain div: a menu owns items and groups of items,
  // and the row pairs its body with its delete control.
  if (showPendingAccessActions) {
    return (
      <DropdownMenuGroup className={rowClassName}>
        <DropdownMenuItem
          className={itemClassName}
          onSelect={(event) => event.preventDefault()}
        >
          {body}
        </DropdownMenuItem>
        {deleteControl}
      </DropdownMenuGroup>
    );
  }

  return (
    <DropdownMenuGroup className={rowClassName}>
      <DropdownMenuItem className={itemClassName} onClick={onClick}>
        {body}
      </DropdownMenuItem>
      {deleteControl}
    </DropdownMenuGroup>
  );
}
