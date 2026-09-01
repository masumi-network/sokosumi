"use client";

import { HeaderMobileSearchControl } from "@/app/components/header/header-mobile-search.client";
import { HeaderNotificationBell } from "@/app/components/header/header-notification-bell.client";

interface HeaderTrailingToolsProps {
  activeOrganizationId: string | null;
}

/**
 * Mobile/desktop trailing tools after workspace/account chrome:
 * Notification Center, then mobile header Search (SOK-924).
 */
export function HeaderTrailingTools({
  activeOrganizationId,
}: HeaderTrailingToolsProps) {
  return (
    <div
      className="flex items-center gap-1.5"
      data-testid="header-trailing-tools"
    >
      <HeaderNotificationBell />
      <HeaderMobileSearchControl activeOrganizationId={activeOrganizationId} />
    </div>
  );
}
