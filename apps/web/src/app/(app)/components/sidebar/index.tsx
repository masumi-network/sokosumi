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
import { Session } from "@/lib/auth/auth";

import AgentLists from "./components/agent-lists";
import AnnouncementCards from "./components/announcement-cards";
import ChatListsClient from "./components/chat-lists.client";
import CustomTrigger from "./components/custom-trigger";
import MenuItems from "./components/menu-items";
import NewChatButton from "./components/new-chat-button";
import ProfileSwitch from "./components/profile-switch";

interface SidebarProps {
  creditsData: UserCreditsData | null;
  currentTimestampMs: number;
  organizationName: string | null;
  session: Session;
  isTaskRailEnabled: boolean;
}

export default function Sidebar({
  creditsData,
  currentTimestampMs,
  organizationName,
  session,
  isTaskRailEnabled,
}: SidebarProps) {
  return (
    <ShadcnSidebar collapsible="icon">
      <SidebarHeader className="h-[64px] border-b">
        <div className="flex items-center gap-2 pt-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:pt-1! group-data-[collapsible=icon]:pl-0!">
          <ProfileSwitch session={session} />
          <CustomTrigger className="group-data-[collapsible=icon]:hidden" />
        </div>
      </SidebarHeader>
      <SidebarContent className="min-h-0 w-full flex-1">
        <div className="flex flex-col gap-0">
          {/* Top Section: Chats */}
          <NewChatButton isTaskRailEnabled={isTaskRailEnabled} />
          {/* Bottom Section: Agents */}
          <MenuItems />
        </div>
        {/* Divider */}
        <SidebarSeparator className="mx-0" />
        <ChatListsClient />
        <AgentLists userId={session.user.id} />
      </SidebarContent>
      <SidebarFooter className="shrink-0 px-0">
        <AnnouncementCards />
        <div className="flex flex-1 gap-2 p-4 pt-0 md:hidden">
          <UserCredits
            creditsData={creditsData}
            currentTimestampMs={currentTimestampMs}
            organizationName={organizationName}
            session={session}
            showCtaButtons={false}
            showCreditUsage
            showCreditUsageOnMobileOnly
            showAvatar={false}
          />
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
