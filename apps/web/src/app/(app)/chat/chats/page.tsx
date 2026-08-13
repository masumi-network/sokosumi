import { connection } from "next/server";
import { Suspense } from "react";
import {
  getPrivateCachedChatListArchivedAndMembers,
  getPrivateCachedMembershipVisibleRooms,
} from "@/app/components/private-sidebar-cache";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import type { ChatRoomsPage } from "@/lib/services";

interface ChatListCacheArgs {
  userId: string;
  activeOrganizationId: string | null;
}

interface ChatChatsOrganizationListProps {
  cacheArgs: ChatListCacheArgs;
  chatRoomsPage: ChatRoomsPage;
  currentUserId: string;
  activeOrganizationId: string | null;
}

/**
 * Streams archived + admin-delete after membership rooms already painted.
 * Suspense fallback on the page mounts OrganizationChatList with real row
 * labels so LCP is not a late skeleton→text swap.
 */
async function ChatChatsListWithArchived({
  cacheArgs,
  chatRoomsPage,
  currentUserId,
  activeOrganizationId,
}: ChatChatsOrganizationListProps) {
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
 * Mobile Chats tab: Personal Assistant (beta-gated) above Channels + DMs
 * (`md:hidden`). Desktop keeps the sidebar list; this route shows nothing
 * meaningful above `md`.
 *
 * Instant Nav uses `chats/loading.tsx` while this page streams after
 * `connection()`.
 *
 * Membership-visible rooms come from the same private-cache slice as the app
 * sidebar (`getPrivateCachedMembershipVisibleRooms`) so cold load does not
 * double-hit Core (SOK-779). Cache key must match sidebar: session user id +
 * active org. Archived + members stream after so channel-row text can win LCP
 * without waiting on that chrome.
 */
export default async function ChatChatsPage() {
  await connection();

  const session = await getSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const currentUserId = session?.user.id ?? "";
  const cacheArgs: ChatListCacheArgs = {
    userId: currentUserId,
    activeOrganizationId,
  };

  const chatRoomsPage = await getPrivateCachedMembershipVisibleRooms(cacheArgs);

  const hermesMenuEnabled = isHermesBetaAccessEmail(session?.user.email);
  const listKey = activeOrganizationId ?? "personal";

  return (
    <Sheet open>
      {/*
        Grow with content — do not height-lock with min-h-0 + overflow-y-auto.
        AppMobileChrome's in-flow tab-bar spacer must sit after the last row in
        main's scroll; padding on a nested overflow flex child does not clear
        the fixed bottom nav (last DM was clipped).
      */}
      <div className="bg-background md:hidden -m-4 flex flex-1 flex-col">
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
          <ChatChatsListWithArchived
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
