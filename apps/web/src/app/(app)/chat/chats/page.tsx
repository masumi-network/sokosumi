import { connection } from "next/server";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import {
  type ChatRoomsPage,
  chatRoomService,
  userService,
} from "@/lib/services";
import { cn } from "@/lib/utils";

const EMPTY_ROOMS_PAGE: ChatRoomsPage = {
  rooms: [],
  nextCursor: null,
};

/**
 * Mobile Chats tab: Personal Assistant (beta-gated) above Channels + DMs
 * (`md:hidden`). Desktop keeps the sidebar list; this route shows nothing
 * meaningful above `md`.
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

  const hermesMenuEnabled = isHermesBetaAccessEmail(session?.user.email);

  return (
    <Sheet open>
      <div
        className={cn(
          "md:hidden -m-4 flex min-h-0 flex-1 flex-col overflow-y-auto bg-background",
          LIST_MOBILE_CREATE_FAB_CLEARANCE,
        )}
      >
        <PersonalAssistantNav enabled={hermesMenuEnabled} />
        {hermesMenuEnabled ? <SidebarSeparator className="-mt-px" /> : null}
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
    </Sheet>
  );
}
