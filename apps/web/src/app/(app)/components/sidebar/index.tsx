import type { ReactNode } from "react";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type { GetUsersByIdCreditsResponse } from "@/lib/clients/generated/core";
import type { CreditUsage } from "@/lib/types/credit";

import AnnouncementCards from "./components/announcement-cards";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";
import PersonalAssistantNav from "./components/personal-assistant-nav.client";
import SidebarLogo from "./components/sidebar-logo.client";

export type SidebarCreditsData = GetUsersByIdCreditsResponse["data"]["credits"];

/**
 * Subscription-period usage only exists once a paid period grants credits; the
 * free plan has no allowance to draw down, so the chip hides the bar entirely.
 */
export function resolveCreditUsage(
  creditsData: SidebarCreditsData | null,
): CreditUsage | null {
  const subscriptionCredits = creditsData?.subscription?.credits ?? null;
  if (!subscriptionCredits || subscriptionCredits.total <= 0) {
    return null;
  }

  const total = Math.max(subscriptionCredits.total, 0);
  const used = Math.min(Math.max(subscriptionCredits.used, 0), total);

  return {
    percentageUsed: Math.min(Math.max((used / total) * 100, 0), 100),
    remaining: Math.max(subscriptionCredits.remaining, 0),
    total,
    used,
  };
}

interface SidebarProps {
  accountFooter: ReactNode;
  chatList: ReactNode;
  hermesMenuEnabled: boolean;
}

export default function Sidebar({
  accountFooter,
  chatList,
  hermesMenuEnabled,
}: SidebarProps) {
  return (
    <ShadcnSidebar collapsible="icon">
      {/*
        h-16 border-b must match HeaderChrome's desktop control row so the
        hairline is one continuous rule across the sidebar/content seam.
      */}
      <SidebarHeader className="border-sidebar-border h-16 border-b p-0">
        <div className="flex h-full w-full items-center justify-between gap-2 px-2 group-data-[collapsible=icon]:justify-center">
          <SidebarLogo />
          <CustomTrigger className="group-data-[collapsible=icon]:hidden shrink-0" />
        </div>
      </SidebarHeader>
      <SidebarContent className="min-h-0 w-full flex-1">
        {/* Grow with nav content (no min-h-0 shrink) so SidebarContent can scroll. */}
        <div className="flex w-full flex-col gap-0">
          <PersonalAssistantNav enabled={hermesMenuEnabled} />
          {hermesMenuEnabled ? <SidebarSeparator className="-mt-px" /> : null}
          <MenuItems />
          <SidebarSeparator />
          {chatList}
        </div>
      </SidebarContent>
      <SidebarFooter className="mt-auto shrink-0 px-0">
        <AnnouncementCards />
        {/* No bottom padding of its own: `SidebarFooter` already contributes
            8px there, matching the 8px this adds on the sides. The inset only
            grows on phones, where the home indicator sits in that 8px. */}
        <div className="p-2 pt-0 pb-[env(safe-area-inset-bottom)] group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          {accountFooter}
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
