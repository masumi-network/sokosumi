import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import UserCredits, {
  type UserCreditsData,
} from "@/app/components/user-credits";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { chatRoomService, userService } from "@/lib/services";
import { resolvePlanSecondaryLabel } from "@/lib/utils/plan-label";

import AdminSettingsMenuGroup from "./components/admin-settings-menu-group.client";
import AnnouncementCards from "./components/announcement-cards";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";
import PersonalAssistantNav from "./components/personal-assistant-nav.client";
import SidebarCreditsFooter from "./components/sidebar-credits-footer.client";
import SidebarLogo from "./components/sidebar-logo.client";
import SidebarNav from "./components/sidebar-nav.client";

interface SidebarProps {
  adminMenuEnabled: boolean;
  creditsData: UserCreditsData | null;
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
  // Hermes beta gate: the Personal Assistant entry only renders for
  // whitelisted email domains; /personal-assistant itself 404s in its layout.
  const hermesMenuEnabled = isHermesBetaAccessEmail(session.user.email);
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
  ] = await Promise.all([
    tPlanPromise,
    membersPromise,
    chatRoomsPromise,
    archivedChatRoomsPromise,
    getDeveloperVendorAdminAccess(),
    planLabelPromise,
  ]);

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
            sessionUser={session.user}
            members={members}
            activeOrganizationId={activeOrganizationId}
            planLabel={planLabel}
            showDeveloperVendors={showDeveloperVendors}
          >
            <PersonalAssistantNav enabled={hermesMenuEnabled} />
            {hermesMenuEnabled ? <SidebarSeparator className="-mt-px" /> : null}
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
        <SidebarCreditsFooter
          buyCreditsLabel={tPlan("getMoreCredits")}
          buyCreditsPath={buyCreditsPath}
          creditsUsage={
            <UserCredits
              creditsData={creditsData}
              currentTimestampMs={currentTimestampMs}
              organizationName={organizationName}
              session={session}
              showCtaButtons={false}
              showCreditUsage
              showAvatar={false}
              lowCreditsThreshold={lowCreditsThreshold}
            />
          }
        />
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
