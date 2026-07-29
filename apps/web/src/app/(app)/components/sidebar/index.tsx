import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type { GetUsersByIdCreditsResponse } from "@/lib/clients/generated/core";
import { chatRoomService, userService } from "@/lib/services";
import type { CreditUsage } from "@/lib/types/credit";
import {
  resolvePlanName,
  resolvePlanSecondaryLabel,
} from "@/lib/utils/plan-label";

import AdminSettingsMenuGroup from "./components/admin-settings-menu-group.client";
import AnnouncementCards from "./components/announcement-cards";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";
import PersonalAssistantNav from "./components/personal-assistant-nav.client";
import { SidebarAccountChip } from "./components/sidebar-account-chip.client";
import SidebarLogo from "./components/sidebar-logo.client";
import SidebarNav from "./components/sidebar-nav.client";

export type SidebarCreditsData = GetUsersByIdCreditsResponse["data"]["credits"];

/**
 * Subscription-period usage only exists once a paid period grants credits; the
 * free plan has no allowance to draw down, so the chip hides the bar entirely.
 */
function resolveCreditUsage(
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
  adminMenuEnabled: boolean;
  creditsData: SidebarCreditsData | null;
  currentTimestampMs: number;
  organizationName: string | null;
  session: Session;
  lowCreditsThreshold: number;
}

export default async function Sidebar({
  adminMenuEnabled,
  creditsData,
  currentTimestampMs,
  organizationName,
  session,
  lowCreditsThreshold,
}: SidebarProps) {
  const tCreditPromise = getTranslations("App.Header.Credit");
  const tPlanPromise = getTranslations("App.Header.Plan");
  const currentPlan = creditsData?.subscription?.plan ?? "free";
  const planForLabel = creditsData === null ? null : currentPlan;
  const buyCreditsPath = resolveLowCreditsBillingPath(currentPlan);
  const activeOrganizationId = session.session.activeOrganizationId ?? null;

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
  const planLabelPromise = tCreditPromise.then((tCredit) =>
    resolvePlanSecondaryLabel({
      plan: planForLabel,
      organizationName: activeOrganizationId
        ? (organizationName ?? tCredit("unavailable"))
        : null,
    }),
  );

  const [
    tPlan,
    members,
    chatRooms,
    archivedChatRooms,
    { showVendors: showDeveloperVendors },
    planLabel,
    planName,
  ] = await Promise.all([
    tPlanPromise,
    membersPromise,
    chatRoomsPromise,
    archivedChatRoomsPromise,
    getDeveloperVendorAdminAccess(),
    planLabelPromise,
    resolvePlanName(planForLabel),
  ]);
  const subscriptionPeriodEnd = creditsData?.subscription?.periodEnd ?? null;

  return (
    <ShadcnSidebar collapsible="icon">
      <SidebarHeader className="h-16 border-b p-0">
        <div className="flex h-full w-full items-center justify-between gap-2 px-2 group-data-[collapsible=icon]:justify-center">
          <SidebarLogo />
          <CustomTrigger className="group-data-[collapsible=icon]:hidden shrink-0" />
        </div>
      </SidebarHeader>
      <SidebarContent className="min-h-0 w-full flex-1">
        <div className="flex min-h-0 flex-col gap-0">
          <SidebarNav
            members={members}
            activeOrganizationId={activeOrganizationId}
            planLabel={planLabel}
            showDeveloperVendors={showDeveloperVendors}
          >
            <PersonalAssistantNav />
            <SidebarSeparator className="-mt-px" />
            <MenuItems />
            <SidebarSeparator />
            <AdminSettingsMenuGroup adminMenuEnabled={adminMenuEnabled} />
            <SidebarSeparator />
            <OrganizationChatList
              rooms={chatRooms}
              archivedRooms={archivedChatRooms}
              currentUserId={session.user.id}
              hasOrganization={Boolean(activeOrganizationId)}
            />
          </SidebarNav>
        </div>
      </SidebarContent>
      <SidebarFooter className="mt-auto shrink-0 px-0">
        <AnnouncementCards />
        {/* No bottom padding of its own: `SidebarFooter` already contributes
            8px there, matching the 8px this adds on the sides. The inset only
            grows on phones, where the home indicator sits in that 8px. */}
        <div className="p-2 pt-0 pb-[env(safe-area-inset-bottom)] group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <SidebarAccountChip
            sessionUser={session.user}
            planName={planName}
            totalCredits={creditsData?.total ?? null}
            extraCredits={creditsData?.buffer ?? null}
            creditUsage={resolveCreditUsage(creditsData)}
            subscriptionPeriodEndMs={
              subscriptionPeriodEnd
                ? new Date(subscriptionPeriodEnd).getTime()
                : null
            }
            currentTimestampMs={currentTimestampMs}
            lowCreditsThreshold={lowCreditsThreshold}
            buyCreditsLabel={tPlan("getMoreCredits")}
            buyCreditsPath={buyCreditsPath}
          />
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
