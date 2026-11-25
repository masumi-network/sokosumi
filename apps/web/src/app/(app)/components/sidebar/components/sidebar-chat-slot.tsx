import type { SessionUser } from "@sokosumi/utils";
import { Suspense } from "react";
import { FeedRooms } from "@/components/chat/feed-rooms";
import { loadSidebarChatList } from "../../private-sidebar-cache";
import { SidebarChatList } from "../../sidebar-chat-list.client";
import { SidebarChatListSkeleton } from "./sidebar-chat-list-skeleton";

interface SidebarChatSlotProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
}

/**
 * The sidebar's chat block. In feed mode it is the Feed and Catch up rows: the
 * room list is not mounted and the server reads no room list for it. Otherwise
 * it is the room list, read from the private-cache slice it shares with
 * `/chat`.
 */
export function SidebarChatSlot({
  sessionUser,
  activeOrganizationId,
}: SidebarChatSlotProps) {
  if (sessionUser.feedMode === true) {
    return (
      <FeedRooms
        currentUserId={sessionUser.id}
        organizationId={activeOrganizationId}
      />
    );
  }
  return (
    <Suspense
      fallback={
        <SidebarChatListSkeleton
          hasOrganization={activeOrganizationId !== null}
        />
      }
    >
      <PrivateCachedSidebarRooms
        userId={sessionUser.id}
        activeOrganizationId={activeOrganizationId}
      />
    </Suspense>
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
  // Shared private-cache slice with `/chat` (SOK-779). Personal coworker
  // directs exist with no active org; Core returns those when organization
  // context is null. Guest rooms (any host org) are mixed into the list.
  // The rows wait for the rooms only. Archived rooms and the owner/admin
  // flag follow as a promise, so a slow read of either holds nothing back.
  const { rooms, deferred } = await loadSidebarChatList({
    userId,
    activeOrganizationId,
  });

  return (
    <SidebarChatList
      // The viewer is part of the key: what one viewer was allowed to see
      // must not stay on screen while the next viewer's read is pending.
      key={`${userId}:${activeOrganizationId ?? "personal"}`}
      rooms={rooms}
      deferred={deferred}
      currentUserId={userId}
      organizationId={activeOrganizationId}
    />
  );
}
