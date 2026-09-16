import type { NotificationItem } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";
import { getNotificationIcon } from "@/lib/utils/notification-icon";

interface NotificationRowIconProps {
  notification: NotificationItem;
}

/**
 * The circle at a notification row's leading edge: the kind as a glyph, and
 * the read state as a tint.
 *
 * Shared by the header panel and the notifications page, so a reader moving
 * between them sees one treatment. It carries no text, and the unread state
 * it tints is named by NotificationUnreadLabel, so it stays hidden from a
 * screen reader.
 */
export function NotificationRowIcon({
  notification,
}: NotificationRowIconProps) {
  const Icon = getNotificationIcon(notification);

  return (
    <span
      data-testid="notification-row-icon"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full",
        // Translucent, so the circle survives the row's hover tint, which is
        // the same colour as the muted surface.
        notification.isRead
          ? "bg-foreground/10 text-muted-foreground"
          : "bg-primary/15 text-primary",
      )}
      aria-hidden
    >
      <Icon className="size-4" />
    </span>
  );
}
