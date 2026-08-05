import { connection } from "next/server";
import { Suspense } from "react";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import DefaultLoading from "@/components/default-loading";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { chatRoomService, userService } from "@/lib/services";

function ChatChatsPageFallback() {
  return <DefaultLoading className="h-full min-h-[300px] w-full flex-1 p-8" />;
}

/**
 * Mobile Chats tab: Channels + DMs list (`md:hidden`).
 * Desktop keeps the sidebar list; this route shows nothing meaningful above `md`.
 */
async function ChatChatsPageContent() {
  await connection();

  const [activeOrganization, session] = await Promise.all([
    userService.getActiveOrganization(),
    getSession(),
  ]);

  const activeOrganizationId = activeOrganization?.id ?? null;
  const chatRoomsPromise = chatRoomService.listRooms().catch(() => []);
  const archivedChatRoomsPromise = activeOrganizationId
    ? chatRoomService.listArchivedRooms().catch(() => [])
    : Promise.resolve(
        [] as Awaited<ReturnType<typeof chatRoomService.listArchivedRooms>>,
      );
  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);

  const [chatRooms, archivedChatRooms, members] = await Promise.all([
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
        rooms={chatRooms}
        archivedRooms={archivedChatRooms}
        currentUserId={session?.user.id ?? ""}
        organizationId={activeOrganizationId}
        canDeleteArchivedRooms={canDeleteArchivedRooms}
        dismissSheetOnNavigate={false}
      />
    </div>
  );
}

export default function ChatChatsPage() {
  return (
    <Suspense fallback={<ChatChatsPageFallback />}>
      <ChatChatsPageContent />
    </Suspense>
  );
}
