import "server-only";

import { cacheLife, cacheTag, updateTag } from "next/cache";
import { cache } from "react";
import { coreClient } from "@/lib/clients/core.client";
import type {
  GetUsersByIdCreditsResponse,
  MemberWithOrganization,
} from "@/lib/clients/generated/core";
import {
  type ChatRoomsPage,
  chatRoomService,
  userService,
} from "@/lib/services";

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

interface PrivateChatListCacheArgs {
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
 * not a hard fail that would blank the whole layout. Empty members with an
 * active org also skeletons the Workspace switcher until that cache goes stale.
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
 * archived+members slice so sidebar + `/chat/chats` share one Core hit for
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
 * slices (same tags/life). Sidebar / header keep this one-call API; `/chat/chats`
 * awaits rooms first then streams archived+members.
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
