import type { SessionUser } from "@sokosumi/utils";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import type {
  ChatRoom,
  ChatRoomInvitation,
  GetUsersByIdCreditsResponse,
  MemberWithOrganization,
} from "@/lib/clients/generated/core";
import type { CreditUsage } from "@/lib/types/credit";

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
export function resolveCreditUsage(
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
  activeOrganizationId: string | null;
  adminMenuEnabled: boolean;
  archivedChatRooms: ChatRoom[];
  archivedChatRoomsNextCursor: string | null;
  buyCreditsLabel: string;
  buyCreditsPath: string;
  canDeleteArchivedRooms: boolean;
  chatRooms: ChatRoom[];
  chatRoomsNextCursor: string | null;
  pendingChatRoomInvitations: ChatRoomInvitation[];
  creditsData: SidebarCreditsData | null;
  creditUsage: CreditUsage | null;
  currentTimestampMs: number;
  currentUserId: string;
  hermesMenuEnabled: boolean;
  lowCreditsThreshold: number;
  members: MemberWithOrganization[];
  planLabel: string;
  planName: string | null;
  sessionUser: SessionUser;
  showDeveloperVendors: boolean;
  subscriptionPeriodEndMs: number | null;
}

export default function Sidebar({
  activeOrganizationId,
  adminMenuEnabled,
  archivedChatRooms,
  archivedChatRoomsNextCursor,
  buyCreditsLabel,
  buyCreditsPath,
  canDeleteArchivedRooms,
  chatRooms,
  chatRoomsNextCursor,
  pendingChatRoomInvitations,
  creditsData,
  creditUsage,
  currentTimestampMs,
  currentUserId,
  hermesMenuEnabled,
  lowCreditsThreshold,
  members,
  planLabel,
  planName,
  sessionUser,
  showDeveloperVendors,
  subscriptionPeriodEndMs,
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
        {/* Grow with nav content (no min-h-0 shrink) so SidebarContent can scroll. */}
        <div className="flex w-full flex-col gap-0">
          <SidebarNav
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
              key={activeOrganizationId ?? "personal"}
              rooms={chatRooms}
              roomsNextCursor={chatRoomsNextCursor}
              archivedRooms={archivedChatRooms}
              archivedRoomsNextCursor={archivedChatRoomsNextCursor}
              pendingInvitations={pendingChatRoomInvitations}
              currentUserId={currentUserId}
              organizationId={activeOrganizationId}
              canDeleteArchivedRooms={canDeleteArchivedRooms}
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
            sessionUser={sessionUser}
            planName={planName}
            totalCredits={creditsData?.total ?? null}
            extraCredits={creditsData?.buffer ?? null}
            creditUsage={creditUsage}
            subscriptionPeriodEndMs={subscriptionPeriodEndMs}
            currentTimestampMs={currentTimestampMs}
            lowCreditsThreshold={lowCreditsThreshold}
            buyCreditsLabel={buyCreditsLabel}
            buyCreditsPath={buyCreditsPath}
          />
        </div>
      </SidebarFooter>
    </ShadcnSidebar>
  );
}
