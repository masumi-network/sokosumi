import type { SessionUser } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { resolveAccountNotice } from "@/app/components/account-notice-state";
import { mapAccountCreditsChrome } from "@/app/components/sidebar";
import { SidebarAccountChip } from "@/app/components/sidebar/components/sidebar-account-chip.client";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { getEnvPublicConfig } from "@/config/env.public";
import { resolvePlanName } from "@/lib/utils/plan-label";

import {
  getCachedMyCredits,
  getPrivateCachedChatListChrome,
} from "./private-sidebar-cache";
import { AccountNoticeHydrator } from "./shell-hydrators.client";

interface SidebarDeferredAccountProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
  adminMenuEnabled: boolean;
}

/**
 * Credits, plan, vendor-admin, and account notice. Streamed behind Suspense
 * so they do not gate nav + membership-visible rooms.
 */
export default async function SidebarDeferredAccount({
  sessionUser,
  activeOrganizationId,
  adminMenuEnabled,
}: SidebarDeferredAccountProps) {
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;

  const [tPlan, chatListChrome, creditsResult, { showVendors }] =
    await Promise.all([
      getTranslations("App.Header.Plan"),
      getPrivateCachedChatListChrome({
        userId: sessionUser.id,
        activeOrganizationId,
      }),
      getCachedMyCredits(),
      getDeveloperVendorAdminAccess(),
    ]);

  const credits = mapAccountCreditsChrome(creditsResult);
  const planName = await resolvePlanName(credits.planForLabel);
  const accountNotice = resolveAccountNotice({
    credits: credits.totalCredits,
    currentPlan: credits.creditsData === null ? null : credits.currentPlan,
    email: sessionUser.email,
    emailVerified: sessionUser.emailVerified,
    threshold: lowCreditsThreshold,
  });

  return (
    <>
      <AccountNoticeHydrator accountNotice={accountNotice} />
      <SidebarAccountChip
        sessionUser={sessionUser}
        planName={planName}
        totalCredits={credits.totalCredits}
        creditUsage={credits.creditUsage}
        subscriptionPeriodEndMs={credits.subscriptionPeriodEndMs}
        currentTimestampMs={credits.currentTimestampMs}
        lowCreditsThreshold={lowCreditsThreshold}
        buyCreditsLabel={tPlan("getMoreCredits")}
        buyCreditsPath={credits.buyCreditsPath}
        adminSettingsChrome={{
          adminMenuEnabled,
          members: chatListChrome.members,
          activeOrganizationId,
          showDeveloperVendors: showVendors,
        }}
      />
    </>
  );
}

export function SidebarAccountChipFallback() {
  return (
    <div
      className="flex w-full items-center gap-2.5 p-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
      aria-hidden
    >
      <div className="bg-muted size-8 shrink-0 animate-pulse rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 group-data-[collapsible=icon]:hidden">
        <div className="bg-muted h-3 w-24 animate-pulse rounded-md" />
        <div className="bg-muted h-3 w-16 animate-pulse rounded-md" />
      </div>
    </div>
  );
}
