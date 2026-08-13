import { Suspense } from "react";
import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "@/app/chat/chats/chat-chats-list-shell";
import {
  getPrivateCachedChatListArchivedAndMembers,
  getPrivateCachedMembershipVisibleRooms,
  type PrivateChatListCacheArgs,
} from "@/app/components/private-sidebar-cache";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import type { ChatRoomsPage } from "@/lib/services";

interface ChatMobileRoomListWithArchivedProps {
  cacheArgs: PrivateChatListCacheArgs;
  chatRoomsPage: ChatRoomsPage;
  currentUserId: string;
  activeOrganizationId: string | null;
}

/**
 * Streams archived + admin-delete after membership rooms already painted.
 * Suspense fallback mounts OrganizationChatList with real row labels so LCP
 * is not a late skeleton→text swap.
 */
async function ChatMobileRoomListWithArchived({
  cacheArgs,
  chatRoomsPage,
  currentUserId,
  activeOrganizationId,
}: ChatMobileRoomListWithArchivedProps) {
  const { archivedChatRoomsPage, members } =
    await getPrivateCachedChatListArchivedAndMembers(cacheArgs);

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
      rooms={chatRoomsPage.rooms}
      roomsNextCursor={chatRoomsPage.nextCursor}
      archivedRooms={archivedChatRoomsPage.rooms}
      archivedRoomsNextCursor={archivedChatRoomsPage.nextCursor}
      currentUserId={currentUserId}
      organizationId={activeOrganizationId}
      canDeleteArchivedRooms={canDeleteArchivedRooms}
      dismissSheetOnNavigate={false}
    />
  );
}

/**
 * Mobile room list at chat root (`md:hidden`). Desktop keeps the sidebar
 * list; this shell shows nothing meaningful above `md`.
 *
 * Membership-visible rooms come from the same private-cache slice as the app
 * sidebar so cold load does not double-hit Core (SOK-779). Archived + members
 * stream after so channel-row text can win LCP.
 */
export async function ChatMobileRoomList() {
  const session = await getSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const currentUserId = session?.user.id ?? "";
  const cacheArgs: PrivateChatListCacheArgs = {
    userId: currentUserId,
    activeOrganizationId,
  };

  const chatRoomsPage = await getPrivateCachedMembershipVisibleRooms(cacheArgs);

  const hermesMenuEnabled = isHermesBetaAccessEmail(session?.user.email);
  const listKey = activeOrganizationId ?? "personal";

  return (
    <Sheet open>
      {/*
        Shell class: top/side main-pad cancel only — see chat-chats-list-shell.ts.
        Grow with content so AppMobileChrome's in-flow tab-bar spacer sits after
        the last row in main's scroll (no nested overflow height-lock).
      */}
      <div className={CHAT_CHATS_MOBILE_LIST_SHELL_CLASS}>
        <PersonalAssistantNav enabled={hermesMenuEnabled} />
        {hermesMenuEnabled ? <SidebarSeparator className="-mt-px" /> : null}
        <Suspense
          fallback={
            <OrganizationChatList
              key={listKey}
              rooms={chatRoomsPage.rooms}
              roomsNextCursor={chatRoomsPage.nextCursor}
              archivedRooms={[]}
              archivedRoomsNextCursor={null}
              currentUserId={currentUserId}
              organizationId={activeOrganizationId}
              canDeleteArchivedRooms={false}
              dismissSheetOnNavigate={false}
            />
          }
        >
          <ChatMobileRoomListWithArchived
            cacheArgs={cacheArgs}
            chatRoomsPage={chatRoomsPage}
            currentUserId={currentUserId}
            activeOrganizationId={activeOrganizationId}
          />
        </Suspense>
      </div>
    </Sheet>
  );
}
