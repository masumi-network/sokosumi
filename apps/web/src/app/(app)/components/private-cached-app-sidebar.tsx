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
import {
  type ChatRoomsPage,
  chatRoomService,
  userService,
} from "@/lib/services";
import { resolvePlanName } from "@/lib/utils/plan-label";

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

const EMPTY_ROOMS_PAGE: ChatRoomsPage = {
  rooms: [],
  nextCursor: null,
};

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

  const tPlanPromise = getTranslations("App.Header.Plan");
  const hermesMenuEnabled = isHermesBetaAccessEmail(sessionUser.email);
  const lowCreditsThreshold =
    getEnvPublicConfig().NEXT_PUBLIC_CREDITS_BUY_BUTTON_THRESHOLD;

  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);
  // Personal coworker directs exist with no active org; Core returns those when
  // organization context is null. Named channels still need an org (empty list then).
  // Guest rooms (any host org) are mixed into listRooms; pending invites are
  // separate (invitee-facing) for the External sidebar section.
  const chatRoomsPromise = chatRoomService
    .listRooms()
    .catch(() => EMPTY_ROOMS_PAGE);
  const archivedChatRoomsPromise = activeOrganizationId
    ? chatRoomService.listArchivedRooms().catch(() => EMPTY_ROOMS_PAGE)
    : Promise.resolve(EMPTY_ROOMS_PAGE);
  const pendingInvitationsPromise = chatRoomService
    .listPendingInvitations()
    .catch(() => []);
  const creditsPromise = getCachedMyCredits();

  const [
    tPlan,
    members,
    chatRoomsPage,
    archivedChatRoomsPage,
    pendingChatRoomInvitations,
    { showVendors: showDeveloperVendors },
    creditsResult,
  ] = await Promise.all([
    tPlanPromise,
    membersPromise,
    chatRoomsPromise,
    archivedChatRoomsPromise,
    pendingInvitationsPromise,
    getDeveloperVendorAdminAccess(),
    creditsPromise,
  ]);

  const chatRooms = chatRoomsPage.rooms;
  const chatRoomsNextCursor = chatRoomsPage.nextCursor;
  const archivedChatRooms = archivedChatRoomsPage.rooms;
  const archivedChatRoomsNextCursor = archivedChatRoomsPage.nextCursor;

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
        pendingChatRoomInvitations={pendingChatRoomInvitations}
        creditsData={creditsData}
        creditUsage={resolveCreditUsage(creditsData)}
        currentTimestampMs={currentTimestampMs}
        currentUserId={sessionUser.id}
        hermesMenuEnabled={hermesMenuEnabled}
        lowCreditsThreshold={lowCreditsThreshold}
        members={members}
        planName={planName}
        sessionUser={sessionUser}
        showDeveloperVendors={showDeveloperVendors}
        subscriptionPeriodEndMs={subscriptionPeriodEndMs}
      />
    </>
  );
}
