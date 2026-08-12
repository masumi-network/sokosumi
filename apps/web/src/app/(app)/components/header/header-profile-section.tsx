import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import {
  getCachedMyCredits,
  getPrivateCachedChatListChrome,
} from "@/app/components/private-sidebar-cache";
import { resolveCreditUsage } from "@/app/components/sidebar";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { getEnvPublicConfig } from "@/config/env.public";
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

  const creditsData = creditsResult?.data.credits ?? null;
  const currentPlan = creditsData?.subscription?.plan ?? "free";
  const planForLabel = creditsData === null ? null : currentPlan;
  const buyCreditsPath = resolveLowCreditsBillingPath(currentPlan);
  const currentTimestampMs = creditsResult?.meta?.timestamp
    ? new Date(creditsResult.meta.timestamp).getTime()
    : 0;
  const subscriptionPeriodEnd = creditsData?.subscription?.periodEnd ?? null;
  const subscriptionPeriodEndMs = subscriptionPeriodEnd
    ? new Date(subscriptionPeriodEnd).getTime()
    : null;
  const planName = await resolvePlanName(planForLabel);

  return {
    planName,
    totalCredits: creditsData?.total ?? null,
    extraCredits: creditsData?.buffer ?? null,
    creditUsage: resolveCreditUsage(creditsData),
    subscriptionPeriodEndMs,
    currentTimestampMs,
    lowCreditsThreshold,
    buyCreditsLabel: tPlan("getMoreCredits"),
    buyCreditsPath,
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
  const { members } = await getPrivateCachedChatListChrome({
    userId: session.user.id,
    activeOrganizationId,
  });

  return (
    <HeaderProfileSectionClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
      accountSummaryPromise={accountSummaryPromise}
    />
  );
}
