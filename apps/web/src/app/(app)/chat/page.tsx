import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  getPrivateCachedChatListArchivedAndMembers,
  getPrivateCachedMembershipVisibleRooms,
  type PrivateChatListCacheArgs,
} from "@/app/components/private-sidebar-cache";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getSession } from "@/lib/auth/auth.server";
import { isBetaAccessEmail } from "@/lib/beta-access";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import type { ChatRoomsPage } from "@/lib/services";

import { CHAT_CHATS_MOBILE_LIST_SHELL_CLASS } from "./chat-chats-list-shell";
import { ChatDesktopHomeRedirect } from "./components/chat-desktop-home-redirect.client";
import {
  CHAT_WELCOME_PATH,
  hasChatNoticeFromRecord,
  type NextSearchParamsRecord,
  pathWithSearch,
  toURLSearchParamsFromRecord,
} from "./utils/chat-route-base";

interface ChatPageProps {
  searchParams: Promise<NextSearchParamsRecord>;
}

interface ChatChatsOrganizationListProps {
  cacheArgs: PrivateChatListCacheArgs;
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
      archivedRooms={archivedChatRoomsPage.rooms}
      currentUserId={currentUserId}
      organizationId={activeOrganizationId}
      canDeleteArchivedRooms={canDeleteArchivedRooms}
      dismissSheetOnNavigate={false}
    />
  );
}

/**
 * Mobile Chats tab at bare `/chat`: Personal Assistant (beta-gated) above
 * Channels + DMs (`md:hidden`). Desktop has no list page — client redirect
 * to Welcome. Notice query → Welcome `/?…` (server).
 *
 * Instant Nav uses `chat/loading.tsx` while this page streams after
 * `connection()`.
 *
 * Membership-visible rooms come from the same private-cache slice as the app
 * sidebar (`getPrivateCachedMembershipVisibleRooms`) so cold load does not
 * double-hit Core (SOK-779). Cache key must match sidebar: session user id +
 * active org. Archived + members stream after so channel-row text can win LCP
 * without waiting on that chrome.
 */
export default async function ChatPage({ searchParams }: ChatPageProps) {
  const params = await searchParams;
  const qs = toURLSearchParamsFromRecord(params);

  if (hasChatNoticeFromRecord(params)) {
    redirect(pathWithSearch(CHAT_WELCOME_PATH, qs));
  }

  await connection();

  const session = await getSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const currentUserId = session?.user.id ?? "";
  const cacheArgs: PrivateChatListCacheArgs = {
    userId: currentUserId,
    activeOrganizationId,
  };

  const chatRoomsPage = await getPrivateCachedMembershipVisibleRooms(cacheArgs);

  const hermesMenuEnabled = isBetaAccessEmail(session?.user.email);
  const listKey = activeOrganizationId ?? "personal";

  return (
    <>
      <ChatDesktopHomeRedirect />
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
                archivedRooms={[]}
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
    </>
  );
}
