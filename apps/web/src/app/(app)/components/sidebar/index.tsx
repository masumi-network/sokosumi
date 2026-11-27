import type { GetUsersByIdCreditsResponse } from "@sokosumi/core-client";
import { type ReactNode, Suspense } from "react";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import { SidebarProjectScope } from "@/app/components/project-scope/sidebar-project-scope";
import { SidebarWorkspaceRow } from "@/app/components/workspace-switcher/sidebar-workspace-row";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { SIDEBAR_PROJECT_SCOPED_CLASS } from "@/components/ui/sidebar-classes";
import type { CreditUsage } from "@/lib/types/credit";

import type { CreditWalletScope } from "./components/account-summary-types";

import AnnouncementCards from "./components/announcement-cards";
import { GlobalRail } from "./components/global-rail.client";
import MenuItems from "./components/menu-items";
import { SidebarContextPanel } from "./components/sidebar-context-panel";

export type SidebarCreditsSubscription =
  GetUsersByIdCreditsResponse["data"]["subscription"];

/**
 * Subscription-period usage only exists once a paid period grants credits; the
 * free plan has no allowance to draw down, so the chip hides the bar entirely.
 */
export function resolveCreditUsage(
  subscription: SidebarCreditsSubscription | null,
): CreditUsage | null {
  const subscriptionCredits = subscription?.credits ?? null;
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

export interface AccountCreditsChrome {
  currentPlan: string;
  planForLabel: string | null;
  buyCreditsPath: string;
  currentTimestampMs: number;
  subscriptionPeriodEndMs: number | null;
  totalCredits: number | null;
  extraCredits: number | null;
  creditUsage: CreditUsage | null;
  creditScope: CreditWalletScope | null;
}

/** Shared header/sidebar mapping from a credits Core payload. */
export function mapAccountCreditsChrome(
  creditsResult: GetUsersByIdCreditsResponse | null,
): AccountCreditsChrome {
  const payload = creditsResult?.data ?? null;
  const subscription = payload?.subscription ?? null;
  const currentPlan = subscription?.plan ?? "free";
  const planForLabel = payload === null ? null : currentPlan;
  const subscriptionPeriodEnd = subscription?.periodEnd ?? null;

  return {
    currentPlan,
    planForLabel,
    buyCreditsPath: resolveLowCreditsBillingPath(currentPlan),
    currentTimestampMs: creditsResult?.meta?.timestamp
      ? new Date(creditsResult.meta.timestamp).getTime()
      : 0,
    subscriptionPeriodEndMs: subscriptionPeriodEnd
      ? new Date(subscriptionPeriodEnd).getTime()
      : null,
    totalCredits: payload?.spendable ?? null,
    extraCredits: payload?.extra.credits.remaining ?? null,
    creditUsage: resolveCreditUsage(subscription),
    creditScope: payload?.scope ?? null,
  };
}

interface SidebarProps {
  workspaceSwitcher: ReactNode;
  accountFooter: ReactNode;
  chatList: ReactNode;
  newsletterEnabled: boolean;
}

export default function Sidebar({
  workspaceSwitcher,
  accountFooter,
  chatList,
  newsletterEnabled,
}: SidebarProps) {
  return (
    <ShadcnSidebar
      mobileTriggerId="app-sidebar-toggle"
      className="md:top-16 md:h-[calc(100dvh-4rem)] md:left-(--app-rail-width) md:group-data-[collapsible=offcanvas]:left-[calc(var(--app-rail-width)-var(--sidebar-width))]"
    >
      <SidebarWorkspaceRow mobile>{workspaceSwitcher}</SidebarWorkspaceRow>
      <GlobalRail mobile />
      <SidebarContent className="min-h-0 w-full flex-1">
        {/* Grow with nav content (no min-h-0 shrink) so SidebarContent can scroll. */}
        <div className="flex w-full flex-col gap-0">
          <SidebarContextPanel chats={chatList}>
            {/* The project scope titles the nav groups it scopes; the chat
              area after them, under its own Chats heading, is outside it. */}
            <Suspense fallback={null}>
              <SidebarProjectScope />
            </Suspense>
            <div className={SIDEBAR_PROJECT_SCOPED_CLASS}>
              <MenuItems newsletterEnabled={newsletterEnabled} />
            </div>
          </SidebarContextPanel>
        </div>
      </SidebarContent>
      {/*
        The hairline is the twin of SidebarHeader's `border-b`: without it the
        scroll region runs straight into the account chip, and at the scroll
        position where a DM row lands flush against it the chip reads as one
        more room. It marks the footer as chrome.
      */}
      <SidebarFooter className="border-sidebar-border relative mt-auto shrink-0 border-t px-0">
        <AnnouncementCards />
        {/* No bottom padding of its own: `SidebarFooter` already contributes
            8px there, matching the 8px this adds on the sides. The inset only
            grows on phones, where the home indicator sits in that 8px. */}
        <div className="p-2 pt-0 pb-[env(safe-area-inset-bottom)]">
          {accountFooter}
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
