import { cn } from "@/lib/utils";

interface UnreadDotProps {
  isRead: boolean;
}

/**
 * The mark that says a row is unread. A read row keeps the slot, so the text
 * beside it wraps at the same width either way.
 */
export function UnreadDot({ isRead }: UnreadDotProps) {
  return (
    <span
      data-testid="notification-unread-dot"
      className={cn(
        "mt-2 size-2 shrink-0 rounded-full",
        isRead ? "invisible" : "bg-primary",
      )}
      aria-hidden
    />
  );
}
