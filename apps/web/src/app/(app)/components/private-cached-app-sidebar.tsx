import type { SessionUser } from "@sokosumi/utils";
import { cacheLife, cacheTag } from "next/cache";
import { getTranslations } from "next-intl/server";
import {
  resolveAccountNotice,
  resolveLowCreditsBillingPath,
} from "@/app/components/account-notice-state";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { getEnvPublicConfig } from "@/config/env.public";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { chatRoomService, userService } from "@/lib/services";
import {
  resolvePlanName,
  resolvePlanSecondaryLabel,
} from "@/lib/utils/plan-label";

import {
  getCachedMyCredits,
  privateSidebarOrgTag,
  privateSidebarUserTag,
} from "./private-sidebar-cache";
import { AccountNoticeHydrator } from "./shell-hydrators.client";
import Sidebar, { resolveCreditUsage } from "./sidebar";

interface PrivateCachedAppSidebarProps {
  sessionUser: SessionUser;
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
  sessionUser,
  activeOrganizationId,
  adminMenuEnabled,
}: PrivateCachedAppSidebarProps) {
  "use cache: private";
  cacheLife({ stale: 300, revalidate: 60, expire: 3600 });
  cacheTag(privateSidebarUserTag(sessionUser.id));
  if (activeOrganizationId) {
    cacheTag(privateSidebarOrgTag(activeOrganizationId));
  }

  const tCreditPromise = getTranslations("App.Header.Credit");
  const tPlanPromise = getTranslations("App.Header.Plan");
  const hermesMenuEnabled = isHermesBetaAccessEmail(sessionUser.email);
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;

  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);
  // Personal coworker directs exist with no active org; Core returns those when
  // organization context is null. Named channels still need an org (empty list then).
  const emptyRoomsPage = {
    rooms: [] as Awaited<ReturnType<typeof chatRoomService.listRooms>>["rooms"],
    nextCursor: null as string | null,
  };
  const chatRoomsPromise = chatRoomService
    .listRooms()
    .catch(() => emptyRoomsPage);
  const archivedChatRoomsPromise = activeOrganizationId
    ? chatRoomService.listArchivedRooms().catch(() => emptyRoomsPage)
    : Promise.resolve(emptyRoomsPage);
  const activeOrganizationPromise = userService.getActiveOrganization();
  const creditsPromise = getCachedMyCredits();

  const [
    tCredit,
    tPlan,
    members,
    chatRoomsPage,
    archivedChatRoomsPage,
    { showVendors: showDeveloperVendors },
    activeOrganization,
    creditsResult,
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

  const chatRooms = chatRoomsPage.rooms;
  const chatRoomsNextCursor = chatRoomsPage.nextCursor;
  const archivedChatRooms = archivedChatRoomsPage.rooms;
  const archivedChatRoomsNextCursor = archivedChatRoomsPage.nextCursor;

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
    email: sessionUser.email,
    emailVerified: sessionUser.emailVerified,
    threshold: lowCreditsThreshold,
  });

  return (
    <>
      <AccountNoticeHydrator accountNotice={accountNotice} />
      <Sidebar
        activeOrganizationId={activeOrganizationId}
        adminMenuEnabled={adminMenuEnabled}
        archivedChatRooms={archivedChatRooms}
        archivedChatRoomsNextCursor={archivedChatRoomsNextCursor}
        buyCreditsLabel={tPlan("getMoreCredits")}
        buyCreditsPath={buyCreditsPath}
        canDeleteArchivedRooms={canDeleteArchivedRooms}
        chatRooms={chatRooms}
        chatRoomsNextCursor={chatRoomsNextCursor}
        creditsData={creditsData}
        creditUsage={resolveCreditUsage(creditsData)}
        currentTimestampMs={currentTimestampMs}
        currentUserId={sessionUser.id}
        hermesMenuEnabled={hermesMenuEnabled}
        lowCreditsThreshold={lowCreditsThreshold}
        members={members}
        planLabel={planLabel}
        planName={planName}
        sessionUser={sessionUser}
        showDeveloperVendors={showDeveloperVendors}
        subscriptionPeriodEndMs={subscriptionPeriodEndMs}
      />
    </>
  );
}
