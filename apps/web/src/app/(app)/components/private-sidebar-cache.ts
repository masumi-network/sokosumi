import "server-only";

import type {
  ChatRoom,
  GetUsersByIdCreditsResponse,
  MemberWithOrganization,
} from "@sokosumi/core-client";
import { cacheLife, cacheTag, updateTag } from "next/cache";
import { cache } from "react";
import { coreClient } from "@/lib/clients/core.client";
import { viewerIsOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import {
  type ChatRoomsPage,
  chatRoomService,
} from "@/lib/services/chat-room.service";
import { userService } from "@/lib/services/user.service";
export function privateSidebarUserTag(userId: string): string {
  return `app-sidebar-user-${userId}`;
}

export function privateSidebarOrgTag(organizationId: string): string {
  return `app-sidebar-org-${organizationId}`;
}

const EMPTY_ROOMS_PAGE: ChatRoomsPage = {
  rooms: [],
  nextCursor: null,
};

export interface PrivateCachedChatListChrome {
  chatRoomsPage: ChatRoomsPage;
  archivedChatRoomsPage: ChatRoomsPage;
  members: MemberWithOrganization[];
}

export interface PrivateCachedChatListArchivedAndMembers {
  archivedChatRoomsPage: ChatRoomsPage;
  members: MemberWithOrganization[];
}

export interface PrivateChatListCacheArgs {
  userId: string;
  activeOrganizationId: string | null;
}

/**
 * Membership-visible rooms only (no archived / members). Fail-soft to empty
 * page on service errors.
 */
export async function loadMembershipVisibleRooms(): Promise<ChatRoomsPage> {
  return chatRoomService.listRooms().catch(() => EMPTY_ROOMS_PAGE);
}

/**
 * Archived rooms + org memberships for admin-delete. Fail-soft empties.
 */
export async function loadChatListArchivedAndMembers(
  activeOrganizationId: string | null,
): Promise<PrivateCachedChatListArchivedAndMembers> {
  const archivedChatRoomsPromise = activeOrganizationId
    ? chatRoomService.listArchivedRooms().catch(() => EMPTY_ROOMS_PAGE)
    : Promise.resolve(EMPTY_ROOMS_PAGE);
  const membersPromise = userService
    .getMyMembersWithOrganizations()
    .catch(() => []);

  const [archivedChatRoomsPage, members] = await Promise.all([
    archivedChatRoomsPromise,
    membersPromise,
  ]);

  return { archivedChatRoomsPage, members };
}

/**
 * Testable body for membership-visible rooms + archived + members.
 * Prefer the private-cache wrappers from RSC so sidebar and chats list share
 * slices (React.cache does not cross use-cache).
 *
 * Fail-soft: service errors become empty pages/arrays (same as pre-SOK-779
 * sidebar/page). When used under private cache those empties are shared until
 * revalidate or `invalidatePrivateSidebarChrome` — intentional chrome tradeoff,
 * not a hard fail that would blank the whole layout.
 */
export async function loadChatListChromeData(
  activeOrganizationId: string | null,
): Promise<PrivateCachedChatListChrome> {
  const [chatRoomsPage, deferred] = await Promise.all([
    loadMembershipVisibleRooms(),
    loadChatListArchivedAndMembers(activeOrganizationId),
  ]);

  return {
    chatRoomsPage,
    archivedChatRoomsPage: deferred.archivedChatRoomsPage,
    members: deferred.members,
  };
}

/**
 * Membership-visible rooms chrome (SOK-779). Same private tags/life as the
 * archived+members slice so sidebar + `/chat` share one Core hit for
 * rooms; chats can await this without waiting on archived/members.
 */
export async function getPrivateCachedMembershipVisibleRooms(
  args: PrivateChatListCacheArgs,
): Promise<ChatRoomsPage> {
  "use cache: private";
  cacheLife({ stale: 300, revalidate: 60, expire: 3600 });
  cacheTag(privateSidebarUserTag(args.userId));
  if (args.activeOrganizationId) {
    cacheTag(privateSidebarOrgTag(args.activeOrganizationId));
  }
  return loadMembershipVisibleRooms();
}

/**
 * Archived rooms + members for admin-delete. Same tags as membership rooms.
 */
export async function getPrivateCachedChatListArchivedAndMembers(
  args: PrivateChatListCacheArgs,
): Promise<PrivateCachedChatListArchivedAndMembers> {
  "use cache: private";
  cacheLife({ stale: 300, revalidate: 60, expire: 3600 });
  cacheTag(privateSidebarUserTag(args.userId));
  if (args.activeOrganizationId) {
    cacheTag(privateSidebarOrgTag(args.activeOrganizationId));
  }
  return loadChatListArchivedAndMembers(args.activeOrganizationId);
}

/**
 * Full chat-list chrome: composes the rooms + archived/members private-cache
 * slices (same tags/life). The account footer and `/you` keep this one-call API; the
 * sidebar's list and `/chat` await rooms first then stream archived+members.
 */
export async function getPrivateCachedChatListChrome(
  args: PrivateChatListCacheArgs,
): Promise<PrivateCachedChatListChrome> {
  const [chatRoomsPage, deferred] = await Promise.all([
    getPrivateCachedMembershipVisibleRooms(args),
    getPrivateCachedChatListArchivedAndMembers(args),
  ]);

  return {
    chatRoomsPage,
    archivedChatRoomsPage: deferred.archivedChatRoomsPage,
    members: deferred.members,
  };
}

/** What the sidebar's chat list can render its rows without. */
export interface SidebarChatListDeferred {
  archivedRooms: ChatRoom[];
  isOrgOwnerOrAdmin: boolean;
}

/**
 * The sidebar's chat list: the rooms as soon as they are read, and the rest
 * as a promise the list fills in when it settles.
 *
 * Archived rooms and memberships only feed the Archived section and the
 * owner/admin menus. Awaited beside the rooms they held every row back until
 * the slowest of the three reads ended. Both slices are the ones
 * `getPrivateCachedChatListChrome` composes, so the account footer, `/you`
 * and `/chat` still share them.
 */
export async function loadSidebarChatList(
  args: PrivateChatListCacheArgs,
): Promise<{
  rooms: ChatRoom[];
  deferred: Promise<SidebarChatListDeferred>;
}> {
  // Started before the rooms are awaited, so the two reads still overlap.
  const deferred = getPrivateCachedChatListArchivedAndMembers(args).then(
    ({ archivedChatRoomsPage, members }): SidebarChatListDeferred => ({
      archivedRooms: archivedChatRoomsPage.rooms,
      isOrgOwnerOrAdmin: viewerIsOrganizationOwnerOrAdmin(
        args.activeOrganizationId,
        members,
      ),
    }),
  );
  // Both reads inside are fail-soft, so this rejects only when the cache
  // layer does. The rejection goes to
  // the list as it is, and the list keeps its rows. This handler only stops
  // it from being unhandled before the list receives it: while the rooms are
  // still being read, or when that read throws.
  deferred.catch(() => undefined);
  const { rooms } = await getPrivateCachedMembershipVisibleRooms(args);
  return { rooms, deferred };
}

/**
 * Request-scoped credits read shared by private sidebar + overlays so a cold
 * layout fill does not double-hit Core for the same session.
 */
export const getCachedMyCredits = cache(
  async (): Promise<GetUsersByIdCreditsResponse | null> => {
    try {
      return (await coreClient.getMyCredits()) as GetUsersByIdCreditsResponse;
    } catch {
      return null;
    }
  },
);

interface InvalidatePrivateSidebarChromeArgs {
  userId: string;
  organizationId?: string | null;
  previousOrganizationId?: string | null;
}

/**
 * Clears browser private-cache entries for personalized sidebar chrome.
 * Call from Server Actions after org switch, room list mutations, or credits.
 */
export function invalidatePrivateSidebarChrome({
  userId,
  organizationId,
  previousOrganizationId,
}: InvalidatePrivateSidebarChromeArgs): void {
  updateTag(privateSidebarUserTag(userId));
  if (organizationId) {
    updateTag(privateSidebarOrgTag(organizationId));
  }
  if (previousOrganizationId && previousOrganizationId !== organizationId) {
    updateTag(privateSidebarOrgTag(previousOrganizationId));
  }
}
