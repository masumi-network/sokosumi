import { cacheLife, cacheTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import {
  resolveAccountNotice,
  resolveLowCreditsBillingPath,
} from "@/app/components/account-notice-state";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { getEnvPublicConfig } from "@/config/env.public";
import { getSession } from "@/lib/auth/auth.server";
import { coreClient } from "@/lib/clients/core.client";
import type { GetUsersByIdCreditsResponse } from "@/lib/clients/generated/core";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { chatRoomService, userService } from "@/lib/services";
import {
  resolvePlanName,
  resolvePlanSecondaryLabel,
} from "@/lib/utils/plan-label";

import { AccountNoticeHydrator } from "./shell-hydrators.client";
import Sidebar, { resolveCreditUsage } from "./sidebar";

interface PrivateCachedAppSidebarProps {
  userId: string;
  activeOrganizationId: string | null;
  adminMenuEnabled: boolean;
}

/**
 * Session-aware sidebar chrome for Instant Navigations.
 * Private-cache slice loads all sidebar data inside this boundary so soft
 * navigations can fill the Suspense hole from browser memory without uncached
 * async SC children under the cached tree.
 */
export default async function PrivateCachedAppSidebar({
  userId,
  activeOrganizationId,
  adminMenuEnabled,
}: PrivateCachedAppSidebarProps) {
  "use cache: private";
  cacheLife({ stale: 300, revalidate: 60, expire: 3600 });
  cacheTag(`app-sidebar-user-${userId}`);
  if (activeOrganizationId) {
    cacheTag(`app-sidebar-org-${activeOrganizationId}`);
  }

  const session = await getSession();
  if (!session || session.user.id !== userId) {
    return null;
  }

  const tCreditPromise = getTranslations("App.Header.Credit");
  const tPlanPromise = getTranslations("App.Header.Plan");
  const hermesMenuEnabled = isHermesBetaAccessEmail(session.user.email);
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;

  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);
  // Personal coworker directs exist with no active org; Core returns those when
  // organization context is null. Named channels still need an org (empty list then).
  const chatRoomsPromise = chatRoomService.listRooms().catch(() => []);
  const archivedChatRoomsPromise = activeOrganizationId
    ? chatRoomService.listArchivedRooms().catch(() => [])
    : Promise.resolve(
        [] as Awaited<ReturnType<typeof chatRoomService.listArchivedRooms>>,
      );
  const activeOrganizationPromise = userService.getActiveOrganization();
  const creditsPromise = coreClient.getMyCredits().catch(() => null);

  const [
    tCredit,
    tPlan,
    members,
    chatRooms,
    archivedChatRooms,
    { showVendors: showDeveloperVendors },
    activeOrganization,
    creditsResultRaw,
  ] = await Promise.all([
    tCreditPromise,
    tPlanPromise,
    membersPromise,
    chatRoomsPromise,
    archivedChatRoomsPromise,
    getDeveloperVendorAdminAccess(),
    activeOrganizationPromise,
    creditsPromise,
  ]);
  const creditsResult = creditsResultRaw as GetUsersByIdCreditsResponse | null;

  const creditsData = creditsResult?.data.credits ?? null;
  const currentPlan = creditsData?.subscription?.plan ?? "free";
  const planForLabel = creditsData === null ? null : currentPlan;
  const organizationName = activeOrganization?.name ?? null;
  const buyCreditsPath = resolveLowCreditsBillingPath(currentPlan);
  const currentTimestampMs = creditsResult?.meta?.timestamp
    ? new Date(creditsResult.meta.timestamp).getTime()
    : 0;
  const subscriptionPeriodEnd = creditsData?.subscription?.periodEnd ?? null;
  const subscriptionPeriodEndMs = subscriptionPeriodEnd
    ? new Date(subscriptionPeriodEnd).getTime()
    : null;

  const [planLabel, planName] = await Promise.all([
    resolvePlanSecondaryLabel({
      plan: planForLabel,
      organizationName: activeOrganizationId
        ? (organizationName ?? tCredit("unavailable"))
        : null,
    }),
    resolvePlanName(planForLabel),
  ]);

  const canDeleteArchivedRooms = Boolean(
    activeOrganizationId &&
      members.some(
        (membership) =>
          membership.organizationId === activeOrganizationId &&
          isOrganizationOwnerOrAdmin(membership.role),
      ),
  );

  const accountNotice = resolveAccountNotice({
    credits: creditsData?.total ?? null,
    currentPlan: creditsData === null ? null : currentPlan,
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    threshold: lowCreditsThreshold,
  });

  return (
    <>
      <AccountNoticeHydrator accountNotice={accountNotice} />
      <Sidebar
        activeOrganizationId={activeOrganizationId}
        adminMenuEnabled={adminMenuEnabled}
        archivedChatRooms={archivedChatRooms}
        buyCreditsLabel={tPlan("getMoreCredits")}
        buyCreditsPath={buyCreditsPath}
        canDeleteArchivedRooms={canDeleteArchivedRooms}
        chatRooms={chatRooms}
        creditsData={creditsData}
        creditUsage={resolveCreditUsage(creditsData)}
        currentTimestampMs={currentTimestampMs}
        currentUserId={session.user.id}
        hermesMenuEnabled={hermesMenuEnabled}
        lowCreditsThreshold={lowCreditsThreshold}
        members={members}
        planLabel={planLabel}
        planName={planName}
        sessionUser={session.user}
        showDeveloperVendors={showDeveloperVendors}
        subscriptionPeriodEndMs={subscriptionPeriodEndMs}
      />
    </>
  );
}
