import type { SessionUser } from "@sokosumi/utils";
import { Suspense } from "react";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { hasSokoBotBetaAccess } from "@/lib/beta-access";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { getPrivateCachedChatListChrome } from "./private-sidebar-cache";
import Sidebar from "./sidebar";
import { SidebarChatListSkeleton } from "./sidebar/components/sidebar-chat-list-skeleton";
import SidebarDeferredAccount, {
  SidebarAccountChipFallback,
} from "./sidebar-deferred-account";

interface PrivateCachedAppSidebarProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
  adminMenuEnabled: boolean;
  calendarMenuEnabled: boolean;
}

/**
 * Sync sidebar frame so cold load paints nav immediately after session.
 * Membership-visible rooms stay in a private-cache slice (shared with
 * `/chat`). Credits / vendor-admin / account notice stream. Pending
 * invites are filled by OrganizationChatList's client refresh.
 */
export default function PrivateCachedAppSidebar({
  sessionUser,
  activeOrganizationId,
  adminMenuEnabled,
  calendarMenuEnabled,
}: PrivateCachedAppSidebarProps) {
  const sokoBotMenuEnabled = hasSokoBotBetaAccess(sessionUser);

  return (
    <Sidebar
      sokoBotMenuEnabled={sokoBotMenuEnabled}
      calendarMenuEnabled={calendarMenuEnabled}
      chatList={
        <Suspense
          fallback={
            <SidebarChatListSkeleton
              hasOrganization={activeOrganizationId !== null}
            />
          }
        >
          <PrivateCachedSidebarRooms
            userId={sessionUser.id}
            activeOrganizationId={activeOrganizationId}
          />
        </Suspense>
      }
      accountFooter={
        <Suspense fallback={<SidebarAccountChipFallback />}>
          <SidebarDeferredAccount
            sessionUser={sessionUser}
            activeOrganizationId={activeOrganizationId}
            adminMenuEnabled={adminMenuEnabled}
          />
        </Suspense>
      }
    />
  );
}

interface PrivateCachedSidebarRoomsProps {
  userId: string;
  activeOrganizationId: string | null;
}

async function PrivateCachedSidebarRooms({
  userId,
  activeOrganizationId,
}: PrivateCachedSidebarRoomsProps) {
  // Shared private-cache slice with `/chat` (SOK-779). Personal coworker
  // directs exist with no active org; Core returns those when organization
  // context is null. Guest rooms (any host org) are mixed into the list.
  const chatListChrome = await getPrivateCachedChatListChrome({
    userId,
    activeOrganizationId,
  });

  const { members } = chatListChrome;
  const chatRooms = chatListChrome.chatRoomsPage.rooms;
  const archivedChatRooms = chatListChrome.archivedChatRoomsPage.rooms;

  const canDeleteArchivedRooms = Boolean(
    activeOrganizationId &&
      members.some(
        (membership) =>
          membership.organizationId === activeOrganizationId &&
          isOrganizationOwnerOrAdmin(membership.role),
      ),
  );

  return (
    <OrganizationChatList
      key={activeOrganizationId ?? "personal"}
      rooms={chatRooms}
      archivedRooms={archivedChatRooms}
      currentUserId={userId}
      organizationId={activeOrganizationId}
      canDeleteArchivedRooms={canDeleteArchivedRooms}
    />
  );
}
