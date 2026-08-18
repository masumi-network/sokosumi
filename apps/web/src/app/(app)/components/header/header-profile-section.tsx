import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import {
  getCachedMyCredits,
  getPrivateCachedChatListChrome,
} from "@/app/components/private-sidebar-cache";
import { mapAccountCreditsChrome } from "@/app/components/sidebar";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { getEnvPublicConfig } from "@/config/env.public";
import { userService } from "@/lib/services";
import { resolvePlanName } from "@/lib/utils/plan-label";

import { HeaderNotificationBell } from "./header-notification-bell.client";
import HeaderProfileSectionClient, {
  type HeaderAccountSummary,
} from "./header-profile-section.client";

interface HeaderProfileSectionProps {
  session: Session;
  adminMenuEnabled: boolean;
}

function HeaderProfileSectionSkeleton() {
  return (
    <div className="flex h-8 items-center gap-1.5" aria-hidden>
      <div className="bg-muted h-3 w-20 animate-pulse rounded-md" />
      <div className="bg-muted size-4 shrink-0 animate-pulse rounded-full" />
      <div className="bg-muted size-4 shrink-0 animate-pulse rounded-sm" />
    </div>
  );
}

export default function HeaderProfileSection({
  session,
  adminMenuEnabled,
}: HeaderProfileSectionProps) {
  return (
    <div className="flex h-8 items-center gap-1.5 md:h-auto">
      <Suspense fallback={<HeaderProfileSectionSkeleton />}>
        <HeaderProfileSectionInner
          session={session}
          adminMenuEnabled={adminMenuEnabled}
        />
      </Suspense>
      <HeaderNotificationBell />
    </div>
  );
}

async function loadHeaderAccountSummary(
  adminMenuEnabled: boolean,
): Promise<HeaderAccountSummary> {
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;

  const [tPlan, { showVendors: showDeveloperVendors }, creditsResult] =
    await Promise.all([
      getTranslations("App.Header.Plan"),
      getDeveloperVendorAdminAccess(),
      getCachedMyCredits(),
    ]);

  const credits = mapAccountCreditsChrome(creditsResult);
  const planName = await resolvePlanName(credits.planForLabel);

  return {
    planName,
    totalCredits: credits.totalCredits,
    extraCredits: credits.extraCredits,
    creditUsage: credits.creditUsage,
    subscriptionPeriodEndMs: credits.subscriptionPeriodEndMs,
    currentTimestampMs: credits.currentTimestampMs,
    lowCreditsThreshold,
    buyCreditsLabel: tPlan("getMoreCredits"),
    buyCreditsPath: credits.buyCreditsPath,
    adminMenuEnabled,
    showDeveloperVendors,
  };
}

async function HeaderProfileSectionInner({
  session,
  adminMenuEnabled,
}: HeaderProfileSectionProps) {
  const activeOrganizationId = session.session.activeOrganizationId ?? null;

  // Start account-summary work immediately. Await the shared private-cache
  // chrome slice (rooms + archived + members) so the switcher uses last-known
  // members. Notification Center is a sibling of this Suspense and does not
  // wait. Credits stay on accountSummaryPromise.
  const accountSummaryPromise = loadHeaderAccountSummary(adminMenuEnabled);
  const [{ members }, workspaceAccess] = await Promise.all([
    getPrivateCachedChatListChrome({
      userId: session.user.id,
      activeOrganizationId,
    }),
    userService.getWorkspaceAccess(),
  ]);

  return (
    <HeaderProfileSectionClient
      sessionUser={session.user}
      members={members}
      hasPersonalWorkspace={workspaceAccess?.hasPersonalWorkspace ?? false}
      activeOrganizationId={activeOrganizationId}
      accountSummaryPromise={accountSummaryPromise}
    />
  );
}
