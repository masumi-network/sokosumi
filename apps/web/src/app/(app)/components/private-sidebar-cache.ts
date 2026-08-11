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

/**
 * Testable body for membership-visible rooms + archived + members.
 * Prefer {@link getPrivateCachedChatListChrome} from RSC so sidebar and chats
 * list share one private-cache slice (React.cache does not cross use-cache).
 */
export async function loadChatListChromeData(
  activeOrganizationId: string | null,
): Promise<PrivateCachedChatListChrome> {
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

  return { chatRoomsPage, archivedChatRoomsPage, members };
}

/**
 * Membership-visible rooms chrome shared by private sidebar + `/chat/chats`.
 * Same private tags/life as sidebar so cold composition hits Core once.
 */
export async function getPrivateCachedChatListChrome(args: {
  userId: string;
  activeOrganizationId: string | null;
}): Promise<PrivateCachedChatListChrome> {
  "use cache: private";
  cacheLife({ stale: 300, revalidate: 60, expire: 3600 });
  cacheTag(privateSidebarUserTag(args.userId));
  if (args.activeOrganizationId) {
    cacheTag(privateSidebarOrgTag(args.activeOrganizationId));
  }

  return loadChatListChromeData(args.activeOrganizationId);
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
