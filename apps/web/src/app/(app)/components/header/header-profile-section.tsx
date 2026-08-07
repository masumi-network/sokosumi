import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import { getCachedMyCredits } from "@/app/components/private-sidebar-cache";
import { resolveCreditUsage } from "@/app/components/sidebar";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { getEnvPublicConfig } from "@/config/env.public";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { userService } from "@/lib/services";
import { resolvePlanName } from "@/lib/utils/plan-label";

import HeaderProfileSectionClient, {
  type HeaderAccountSummary,
} from "./header-profile-section.client";

interface HeaderProfileSectionProps {
  session: Session;
  adminMenuEnabled: boolean;
}

function HeaderProfileSectionSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex flex-col items-end gap-1">
        <div className="bg-muted h-4 w-28 animate-pulse rounded-md" />
        <div className="bg-muted h-3 w-36 animate-pulse rounded-md" />
      </div>
      <div className="bg-muted size-8 animate-pulse rounded-full" />
    </div>
  );
}

export default function HeaderProfileSection({
  session,
  adminMenuEnabled,
}: HeaderProfileSectionProps) {
  return (
    <Suspense fallback={<HeaderProfileSectionSkeleton />}>
      <HeaderProfileSectionInner
        session={session}
        adminMenuEnabled={adminMenuEnabled}
      />
    </Suspense>
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

  // Start account-summary work immediately, but only await members here so
  // desktop workspace switch + notification bell are not blocked by credits.
  const accountSummaryPromise = loadHeaderAccountSummary(adminMenuEnabled);
  const members = await userService
    .getMyMembersWithOrganizations()
    .catch(() => [] as MemberWithOrganization[]);

  return (
    <HeaderProfileSectionClient
      sessionUser={session.user}
      members={members}
      activeOrganizationId={activeOrganizationId}
      accountSummaryPromise={accountSummaryPromise}
    />
  );
}
