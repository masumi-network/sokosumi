import type { SessionUser } from "@sokosumi/utils";
import { Suspense } from "react";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { getPrivateCachedChatListChrome } from "./private-sidebar-cache";
import Sidebar from "./sidebar";
import SidebarDeferredAccount, {
  SidebarAccountChipFallback,
} from "./sidebar-deferred-account";

interface PrivateCachedAppSidebarProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
  adminMenuEnabled: boolean;
}

/**
 * Sync sidebar frame so cold load paints nav immediately after session.
 * Membership-visible rooms stay in a private-cache slice (shared with
 * the mobile chat-root list). Credits / vendor-admin / account notice stream. Pending
 * invites are filled by OrganizationChatList's client refresh.
 */
export default function PrivateCachedAppSidebar({
  sessionUser,
  activeOrganizationId,
  adminMenuEnabled,
}: PrivateCachedAppSidebarProps) {
  const hermesMenuEnabled = isHermesBetaAccessEmail(sessionUser.email);

  return (
    <Sidebar
      hermesMenuEnabled={hermesMenuEnabled}
      chatList={
        <Suspense fallback={<SidebarChatListFallback />}>
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

function SidebarChatListFallback() {
  return (
    <div className="flex flex-col gap-2 px-3 py-2" aria-hidden>
      <div className="bg-muted h-4 w-20 animate-pulse rounded-md" />
      <div className="bg-muted h-8 w-full animate-pulse rounded-md" />
      <div className="bg-muted h-8 w-full animate-pulse rounded-md" />
      <div className="bg-muted h-8 w-5/6 animate-pulse rounded-md" />
    </div>
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
  // Shared private-cache slice with the mobile chat-root list (SOK-779). Personal coworker
  // directs exist with no active org; Core returns those when organization
  // context is null. Guest rooms (any host org) are mixed into the list.
  const chatListChrome = await getPrivateCachedChatListChrome({
    userId,
    activeOrganizationId,
  });

  const { members } = chatListChrome;
  const chatRooms = chatListChrome.chatRoomsPage.rooms;
  const chatRoomsNextCursor = chatListChrome.chatRoomsPage.nextCursor;
  const archivedChatRooms = chatListChrome.archivedChatRoomsPage.rooms;
  const archivedChatRoomsNextCursor =
    chatListChrome.archivedChatRoomsPage.nextCursor;

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
      roomsNextCursor={chatRoomsNextCursor}
      archivedRooms={archivedChatRooms}
      archivedRoomsNextCursor={archivedChatRoomsNextCursor}
      currentUserId={userId}
      organizationId={activeOrganizationId}
      canDeleteArchivedRooms={canDeleteArchivedRooms}
    />
  );
}
