"use client";

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
import { getNotificationIcon } from "@/lib/utils/notification-icon";
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
  const Icon = getNotificationIcon(notification);
  const message = formatMessage(
    notification.messageKey,
    notification.messageParams ?? {},
  );
  const showVendorGrantActions = isPendingVendorGrantNotification(notification);
  const showCoworkerAccessActions =
    isPendingCoworkerAccessNotification(notification);
  const showPendingAccessActions =
    showVendorGrantActions || showCoworkerAccessActions;

  // The row is the highlight unit: it spans the panel edge to edge and tints
  // as one surface whenever the body or the delete control is highlighted.
  // Unread is the icon's colour and the weight, so the tint is free to mean "here".
  const rowClassName =
    "group/row has-data-highlighted:bg-accent flex w-full items-start";

  const itemClassName = cn(
    "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-none py-3 pr-1 pl-3 focus:bg-transparent",
    showPendingAccessActions && "cursor-default",
  );

  const body = (
    <div className="flex w-full items-start gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          // Opaque, so the disc no longer tracks the row's hover tint the way
          // the old alpha did: on a hovered row it measures 1.16:1 light and
          // 1.28:1 dark against --card-background, so its edge reads as faint.
          // The glyph inside is what carries the state, and it keeps 4.07:1
          // light and 3.52:1 dark on --quinary. The next step up, --quaternary,
          // would sharpen the disc and drop that glyph to 2.28:1 in dark, under
          // the 3:1 floor, which is the worse trade.
          notification.isRead
            ? "bg-quinary text-muted-foreground"
            : "bg-primary/15 text-primary",
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {showPendingAccessActions ? (
          <button
            type="button"
            className="hover:bg-card-background -mx-1 cursor-pointer rounded-md px-1 text-left"
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
      isRead={notification.isRead}
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
