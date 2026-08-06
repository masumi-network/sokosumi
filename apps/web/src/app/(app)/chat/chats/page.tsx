import { connection } from "next/server";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import {
  type ChatRoomsPage,
  chatRoomService,
  userService,
} from "@/lib/services";

const EMPTY_ROOMS_PAGE: ChatRoomsPage = {
  rooms: [],
  nextCursor: null,
};

/**
 * Mobile Chats tab: Channels + DMs list (`md:hidden`).
 * Desktop keeps the sidebar list; this route shows nothing meaningful above `md`.
 *
 * Instant Nav uses `chats/loading.tsx` while this page streams after
 * `connection()`.
 */
export default async function ChatChatsPage() {
  await connection();

  const [activeOrganization, session] = await Promise.all([
    userService.getActiveOrganization(),
    getSession(),
  ]);

  const activeOrganizationId = activeOrganization?.id ?? null;
  const chatRoomsPromise = chatRoomService
    .listRooms()
    .catch(() => EMPTY_ROOMS_PAGE);
  const archivedChatRoomsPromise = activeOrganizationId
    ? chatRoomService.listArchivedRooms().catch(() => EMPTY_ROOMS_PAGE)
    : Promise.resolve(EMPTY_ROOMS_PAGE);
  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);

  const [chatRoomsPage, archivedChatRoomsPage, members] = await Promise.all([
    chatRoomsPromise,
    archivedChatRoomsPromise,
    membersPromise,
  ]);

  const canDeleteArchivedRooms = Boolean(
    activeOrganizationId &&
      members.some(
        (membership) =>
          membership.organizationId === activeOrganizationId &&
          isOrganizationOwnerOrAdmin(membership.role),
      ),
  );

  return (
    <div className="md:hidden -m-4 min-h-0 flex-1 overflow-y-auto">
      <OrganizationChatList
        key={activeOrganizationId ?? "personal"}
        rooms={chatRoomsPage.rooms}
        roomsNextCursor={chatRoomsPage.nextCursor}
        archivedRooms={archivedChatRoomsPage.rooms}
        archivedRoomsNextCursor={archivedChatRoomsPage.nextCursor}
        currentUserId={session?.user.id ?? ""}
        organizationId={activeOrganizationId}
        canDeleteArchivedRooms={canDeleteArchivedRooms}
        dismissSheetOnNavigate={false}
      />
    </div>
  );
}
