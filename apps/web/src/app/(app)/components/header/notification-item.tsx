"use client";

import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { DeleteNotificationMenuItem } from "@/components/notifications/delete-notification-menu-item";
import { MarkNotificationReadMenuItem } from "@/components/notifications/mark-notification-read-menu-item";
import { MarkNotificationUnreadMenuItem } from "@/components/notifications/mark-notification-unread-menu-item";
import { NotificationRowIcon } from "@/components/notifications/notification-row-icon";
import {
  NotificationUnreadLabel,
  NotificationUnreadRail,
} from "@/components/notifications/notification-unread-signal";
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

  // The row is the highlight unit: it spans the panel edge to edge and tints
  // as one surface whenever the body or the delete control is highlighted.
  // Unread is the icon's colour and a bar on the leading edge, so the tint is
  // free to mean "here".
  //
  // The rail is its own element rather than a tint, so it stays legible while
  // the row is highlighted, and it lines up down the list so several unread
  // rows read as a group at a glance. Its geometry and its forced colors
  // behaviour live in the shared component, which the notifications page
  // renders too.
  const rowClassName =
    "group/row has-data-highlighted:bg-accent flex w-full items-start";

  const itemClassName = cn(
    "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-none py-3 pr-1 pl-3 focus:bg-transparent",
    showPendingAccessActions && "cursor-default",
  );

  const body = (
    <div className="flex w-full items-start gap-3">
      <NotificationRowIcon notification={notification} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <NotificationUnreadLabel isRead={notification.isRead} />
        {/* The message keeps one weight in both states. A heavier unread
            message re-wraps the moment the row is marked read, and every row
            below it moves. The bar and the icon tint carry the state instead,
            and neither changes a glyph's width. */}
        {showPendingAccessActions ? (
          <button
            type="button"
            className="hover:bg-accent/50 -mx-1 cursor-pointer rounded-md px-1 text-left"
            onClick={onClick}
          >
            <p className="text-sm">{message}</p>
            <p className="text-muted-foreground text-xs">
              {formatTime(notification.createdAt)}
            </p>
          </button>
        ) : (
          <>
            <p className="text-sm">{message}</p>
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

  // One control per row, never both: each row is in one state, and the only
  // move worth offering is the one that changes it. A control that does
  // nothing still costs the reader a look.
  const markReadControl = notification.isRead ? (
    <MarkNotificationUnreadMenuItem
      notificationId={notification.id}
      notificationMessage={message}
    />
  ) : (
    <MarkNotificationReadMenuItem
      notificationId={notification.id}
      notificationMessage={message}
    />
  );

  // A group rather than a plain div: a menu owns items and groups of items,
  // and the row pairs its body with its delete control.
  if (showPendingAccessActions) {
    return (
      <DropdownMenuGroup className={rowClassName}>
        <NotificationUnreadRail isRead={notification.isRead} />
        <DropdownMenuItem
          className={itemClassName}
          onSelect={(event) => event.preventDefault()}
        >
          {body}
        </DropdownMenuItem>
        {markReadControl}
        {deleteControl}
      </DropdownMenuGroup>
    );
  }

  return (
    <DropdownMenuGroup className={rowClassName}>
      <NotificationUnreadRail isRead={notification.isRead} />
      <DropdownMenuItem className={itemClassName} onClick={onClick}>
        {body}
      </DropdownMenuItem>
      {markReadControl}
      {deleteControl}
    </DropdownMenuGroup>
  );
}
