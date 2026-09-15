"use client";

import { useTranslations } from "next-intl";
import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { DeleteNotificationMenuItem } from "@/components/notifications/delete-notification-menu-item";
import { MarkNotificationReadMenuItem } from "@/components/notifications/mark-notification-read-menu-item";
import { MarkNotificationUnreadMenuItem } from "@/components/notifications/mark-notification-unread-menu-item";
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
  const t = useTranslations("Components.NotificationCenter");
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
  //
  // Unread also carries a bar on the leading edge. The bar is a border rather
  // than a tint, so it stays legible while the row is highlighted, and it lines
  // up down the list so several unread rows read as a group at a glance. A read
  // row keeps the same border width in transparent, so no text shifts when a
  // row changes state under the reader.
  const rowClassName = cn(
    "group/row has-data-highlighted:bg-accent flex w-full items-start border-l-2",
    notification.isRead ? "border-l-transparent" : "border-l-primary",
  );

  const itemClassName = cn(
    "flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1 rounded-none py-3 pr-1 pl-3 focus:bg-transparent",
    showPendingAccessActions && "cursor-default",
  );

  const body = (
    <div className="flex w-full items-start gap-3">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-full",
          // Translucent, so the circle survives the row's hover tint, which
          // is the same colour as the muted surface.
          notification.isRead
            ? "bg-foreground/10 text-muted-foreground"
            : "bg-primary/15 text-primary",
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* The bar and the icon tint are colour only, and the weight is
            presentation, so none of the three reach a screen reader. This
            names the state in the reading order, ahead of the message. */}
        {notification.isRead ? null : (
          <span className="sr-only">{t("unreadIndicator")}</span>
        )}
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
      <DropdownMenuItem className={itemClassName} onClick={onClick}>
        {body}
      </DropdownMenuItem>
      {markReadControl}
      {deleteControl}
    </DropdownMenuGroup>
  );
}
