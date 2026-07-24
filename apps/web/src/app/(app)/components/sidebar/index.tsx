import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { resolveLowCreditsBillingPath } from "@/app/components/account-notice-state";
import UserCredits, {
  type UserCreditsData,
} from "@/app/components/user-credits";
import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { userService } from "@/lib/services";
import { resolvePlanSecondaryLabel } from "@/lib/utils/plan-label";

import AdminSettingsMenuGroup from "./components/admin-settings-menu-group.client";
import AnnouncementCards from "./components/announcement-cards";
import ChatListsClient from "./components/chat-lists.client";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";
import NewChatTaskActions from "./components/new-chat-task-actions";
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
  const tCredit = await getTranslations("App.Header.Credit");
  const tPlan = await getTranslations("App.Header.Plan");
  // Hermes beta gate: the Personal Assistant entry only renders for
  // whitelisted email domains; /personal-assistant itself 404s in its layout.
  const hermesMenuEnabled = isHermesBetaAccessEmail(session.user.email);
  const currentPlan = creditsData?.subscription?.plan ?? "free";
  const planForLabel = creditsData === null ? null : currentPlan;
  const buyCreditsPath = resolveLowCreditsBillingPath(currentPlan);
  const activeOrganizationId = session.session.activeOrganizationId ?? null;

  let members: Awaited<
    ReturnType<typeof userService.getMyMembersWithOrganizations>
  > = [];
  try {
    members = await userService.getMyMembersWithOrganizations();
  } catch (_error) {
    members = [];
  }

  const [{ showVendors: showDeveloperVendors }, planLabel] = await Promise.all([
    getDeveloperVendorAdminAccess(),
    resolvePlanSecondaryLabel({
      plan: planForLabel,
      organizationName: activeOrganizationId
        ? (organizationName ?? tCredit("unavailable"))
        : null,
    }),
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
            {hermesMenuEnabled ? <SidebarSeparator className="mx-0" /> : null}
            <NewChatTaskActions />
            <SidebarSeparator className="mx-0 mt-2" />
            <MenuItems />
            <SidebarSeparator className="mx-0" />
            <AdminSettingsMenuGroup adminMenuEnabled={adminMenuEnabled} />
            <SidebarSeparator className="mx-0" />
            <ChatListsClient />
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
