"use client";

import { CoworkerAccessNotificationActions } from "@/components/notifications/coworker-access-notification-actions";
import { NotificationReadToggle } from "@/components/notifications/notification-read-toggle";
import { NotificationRowIcon } from "@/components/notifications/notification-row-icon";
import {
  NotificationUnreadLabel,
  NotificationUnreadRail,
} from "@/components/notifications/notification-unread-signal";
import { VendorGrantNotificationActions } from "@/components/notifications/vendor-grant-notification-actions";
import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import {
  COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  isPendingWorkspaceApprovalNotification,
  VENDOR_GRANT_PENDING_MESSAGE_KEY,
} from "@/lib/utils/workspace-approval";

interface NotificationCenterRowProps {
  notification: NotificationItem;
  isPending: boolean;
  message: string;
  timeLabel: string;
  onClick: (notification: NotificationItem) => void;
}

/**
 * One notification, as the header panel and the notifications page both draw
 * it. The two frames list the same rows, so a reader moving between them
 * should not have to learn the row twice.
 *
 * The row is the highlight unit: it spans the frame edge to edge and tints as
 * one surface. Unread is the icon's colour and a bar on the leading edge, so
 * the tint is free to mean "here". The rail is its own element rather than a
 * tint, so it stays legible while the row is highlighted and lines up down the
 * list, which makes several unread rows read as a group at a glance.
 */
export function NotificationCenterRow({
  notification,
  isPending,
  message,
  timeLabel,
  onClick,
}: NotificationCenterRowProps) {
  const showVendorGrantActions = isPendingWorkspaceApprovalNotification(
    notification,
    VENDOR_GRANT_PENDING_MESSAGE_KEY,
  );
  const showCoworkerAccessActions = isPendingWorkspaceApprovalNotification(
    notification,
    COWORKER_ACCESS_PENDING_MESSAGE_KEY,
  );
  const showPendingAccessActions =
    showVendorGrantActions || showCoworkerAccessActions;
  const rowClassName = cn(
    "group/row hover:bg-card-background-hover flex w-full items-start text-left transition-colors [content-visibility:auto] [contain-intrinsic-size:auto_72px]",
    isPending && "bg-card-background-hover opacity-80",
    showPendingAccessActions ? "cursor-default" : "cursor-pointer",
  );

  const body = (
    <div className="flex w-full items-start gap-3">
      <NotificationRowIcon notification={notification} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <NotificationUnreadLabel isRead={notification.isRead} />
        {/* The message keeps one weight in both states. A heavier unread
            message re-wraps the moment the row is marked read, and every row
            below it moves. The rail and the icon tint carry the state
            instead, and neither changes a glyph's width. */}
        {showPendingAccessActions ? (
          <button
            type="button"
            className="hover:bg-card-background-hover -mx-1 cursor-pointer rounded-md px-1 text-left"
            onClick={() => onClick(notification)}
          >
            <p className="text-sm text-pretty">{message}</p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {timeLabel}
            </p>
          </button>
        ) : (
          <>
            <p className="text-sm text-pretty">{message}</p>
            <p className="text-muted-foreground text-xs tabular-nums">
              {timeLabel}
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

  // Beside the row rather than inside it, because the row itself is the button
  // that opens the notification and a button cannot nest in a button.
  const readToggle = (
    <div className="p-3">
      <NotificationReadToggle
        notificationId={notification.id}
        isRead={notification.isRead}
        notificationMessage={message}
      />
    </div>
  );

  // A row whose request is still open answers it in place, so the body is not
  // a link out: accept and deny are the moves, and opening the row is a third
  // one the reader takes from the message itself.
  if (showPendingAccessActions) {
    return (
      <div className={rowClassName}>
        <NotificationUnreadRail isRead={notification.isRead} />
        <div className="flex min-w-0 flex-1 p-3">{body}</div>
        {readToggle}
      </div>
    );
  }

  // The padding lives on the button, so the whole row stays one click target.
  return (
    <div className={rowClassName}>
      <NotificationUnreadRail isRead={notification.isRead} />
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer p-3 text-left"
        onClick={() => onClick(notification)}
      >
        {body}
      </button>
      {readToggle}
    </div>
  );
}
