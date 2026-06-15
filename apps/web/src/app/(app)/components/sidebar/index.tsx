import CreditCta from "@/app/components/credit-cta";
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
import type { Session } from "@/lib/auth/auth";

import AdminMenu from "./components/admin-menu";
import AnnouncementCards from "./components/announcement-cards";
import ChatListsClient from "./components/chat-lists.client";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";
import NewChatTaskActions from "./components/new-chat-task-actions";
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

export default function Sidebar({
  adminMenuEnabled,
  creditsData,
  currentTimestampMs,
  hermesMenuEnabled,
  organizationName,
  session,
  lowCreditsThreshold,
}: SidebarProps) {
  return (
    <ShadcnSidebar collapsible="icon">
      <SidebarHeader className="h-16 border-b p-0">
        <div className="flex h-full w-full items-center justify-between gap-2 px-2 group-data-[collapsible=icon]:justify-center">
          <SidebarLogo />
          <CustomTrigger className="group-data-[collapsible=icon]:hidden shrink-0" />
        </div>
      </SidebarHeader>
      <SidebarContent className="min-h-0 w-full flex-1">
        <div className="flex flex-col gap-0">
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
      <SidebarFooter className="shrink-0 px-0">
        <AnnouncementCards />
        <div className="relative flex flex-1 flex-col gap-4 p-2 pt-0 pb-4 group-data-[collapsible=icon]:hidden">
          <div className="flex flex-col gap-2 px-2">
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
          </div>
          <CreditCta currentPlan={creditsData?.subscription?.plan ?? "free"} />
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
