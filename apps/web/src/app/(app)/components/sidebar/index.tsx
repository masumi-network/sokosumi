import type { Session } from "@sokosumi/utils";
import { getTranslations } from "next-intl/server";
import { resolveLowCreditsBillingPath } from "@/app/components/top-notice-state";
import UserCredits, {
  type UserCreditsData,
} from "@/app/components/user-credits";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";

import AdminMenu from "./components/admin-menu";
import AnnouncementCards from "./components/announcement-cards";
import ChatListsClient from "./components/chat-lists.client";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";
import NewChatTaskActions from "./components/new-chat-task-actions";
import SidebarCreditsFooter from "./components/sidebar-credits-footer.client";
import SidebarLogo from "./components/sidebar-logo.client";

interface SidebarProps {
  adminMenuEnabled: boolean;
  creditsData: UserCreditsData | null;
  currentTimestampMs: number;
  hermesMenuEnabled: boolean;
  organizationName: string | null;
  session: Session;
  lowCreditsThreshold: number;
}

export default async function Sidebar({
  adminMenuEnabled,
  creditsData,
  currentTimestampMs,
  hermesMenuEnabled,
  organizationName,
  session,
  lowCreditsThreshold,
}: SidebarProps) {
  const tPlan = await getTranslations("App.Header.Plan");
  const currentPlan = creditsData?.subscription?.plan ?? "free";
  const buyCreditsPath = resolveLowCreditsBillingPath(currentPlan);

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
          <NewChatTaskActions />
          <SidebarSeparator className="mx-0 mt-2" />
          <MenuItems hermesMenuEnabled={hermesMenuEnabled} />
          {adminMenuEnabled ? (
            <>
              <SidebarSeparator className="mx-0" />
              <AdminMenu />
            </>
          ) : null}
          <SidebarSeparator className="mx-0" />
          <ChatListsClient />
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
