import type { SessionUser } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { mapAccountCreditsChrome } from "@/app/components/sidebar";
import { SidebarAccountChip } from "@/app/components/sidebar/components/sidebar-account-chip.client";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { Skeleton } from "@/components/ui/skeleton";
import { getEnvPublicConfig } from "@/config/env.public";
import { resolvePlanName } from "@/lib/utils/plan-label";

import {
  getCachedMyCredits,
  getPrivateCachedChatListChrome,
} from "./private-sidebar-cache";

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

  return (
    <SidebarAccountChip
      sessionUser={sessionUser}
      planName={planName}
      totalCredits={credits.totalCredits}
      extraCredits={credits.extraCredits}
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
  );
}

export function SidebarAccountChipFallback() {
  return (
    <div className="flex w-full items-center gap-2.5 p-2 pl-1" aria-hidden>
      {/* The square corner comes from `Skeleton` itself, and is what tells
          the account apart from a DM's round face. */}
      <Skeleton className="size-8 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}
