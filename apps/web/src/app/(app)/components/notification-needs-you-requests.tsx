"use client";

import { AccountNoticeRow } from "@/app/components/account-notice-row";
import { NotificationBrowserPermissionPrimer } from "@/app/components/notification-browser-permission-primer";
import { useNotifications } from "@/contexts/notification-provider";

interface NotificationNeedsYouRequestsProps {
  variant: "panel" | "page";
  /** Closes the surrounding panel, which navigation does not unmount. */
  onNavigate?: () => void;
}

/**
 * What the account asks of the reader, as the first rows of the Needs you
 * list in both frames: the account notice and the push primer. They are
 * requests, not news, so they live on Needs you and nowhere else, and the
 * tab counts the notice (see the view filter).
 *
 * The same divider as the list's rows runs between and under them, so the
 * two read as one list. Under the last thing in the frame the card's own
 * edge is the line, so the divider leaves. Each row renders nothing when it
 * has nothing to say, and with both silent the box leaves with them.
 */
export function NotificationNeedsYouRequests({
  variant,
  onNavigate,
}: NotificationNeedsYouRequestsProps) {
  const { view } = useNotifications();

  if (view !== "needs-action") {
    return null;
  }

  return (
    <div className="divide-border divide-y not-last:border-b empty:hidden">
      <AccountNoticeRow variant={variant} onActionComplete={onNavigate} />
      <NotificationBrowserPermissionPrimer
        variant={variant}
        onNavigate={onNavigate}
      />
    </div>
  );
}
