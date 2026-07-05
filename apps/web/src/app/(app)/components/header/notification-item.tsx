"use client";

import { NotificationActorAvatar } from "@/app/components/notification-actor-avatar";
import { CoworkerAccessNotificationActions } from "@/app/notifications/coworker-access-notification-actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import type {
  CoworkerGrant,
  NotificationItem as NotificationItemData,
} from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { useNotificationMessage } from "@/lib/utils/notification-message";

interface NotificationItemProps {
  notification: NotificationItemData;
  onClick: () => void;
  formatTime: (timestamp: string | Date) => string;
  /** Grant behind a COWORKER_ACCESS notification, for the inline decision. */
  grant?: CoworkerGrant | null;
  grantBusy?: boolean;
  onResolveGrant?: (status: "GRANTED" | "DENIED") => void;
}

export function NotificationItem({
  notification,
  onClick,
  formatTime,
  grant,
  grantBusy = false,
  onResolveGrant,
}: NotificationItemProps) {
  const formatMessage = useNotificationMessage();
  const message = formatMessage(
    notification.messageKey,
    notification.messageParams ?? {},
  );

  const showGrantActions =
    notification.kind === "COWORKER_ACCESS" && onResolveGrant != null;

  return (
    <DropdownMenuItem
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 px-4 py-3",
        !notification.isRead && "bg-accent/50",
      )}
      onClick={onClick}
      // Approve/Deny inside the row must not close the menu; they stop
      // propagation, and this keeps Radix from treating them as a select.
      onSelect={
        showGrantActions ? (event) => event.preventDefault() : undefined
      }
    >
      <div className="flex w-full items-start gap-3">
        <NotificationActorAvatar notification={notification} grant={grant} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className={cn("text-sm", !notification.isRead && "font-medium")}>
            {message}
          </p>
          <p className="text-muted-foreground text-xs">
            {formatTime(notification.createdAt)}
          </p>
        </div>
      </div>
      {showGrantActions ? (
        <CoworkerAccessNotificationActions
          grant={grant ?? null}
          busy={grantBusy}
          onResolve={onResolveGrant}
        />
      ) : null}
    </DropdownMenuItem>
  );
}
