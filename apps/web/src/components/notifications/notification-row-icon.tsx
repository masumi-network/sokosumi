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
  );
}
