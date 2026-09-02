import { HeaderMobileSearchControl } from "@/app/components/header/header-mobile-search.client";
import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";

/**
 * Mobile/desktop trailing tools after desktop Workspace chrome:
 * Notification Center, then mobile header Search (SOK-924).
 * Mobile Workspace switch + account avatar live on You (SOK-926).
 */
export function HeaderTrailingTools() {
  return (
    <div
      className="flex items-center gap-1.5"
      data-testid="header-trailing-tools"
    >
      <HeaderNotificationBell />
      <HeaderMobileSearchControl />
    </div>
  );
}
