import { getPrivateCachedMembershipVisibleRooms } from "@/app/components/private-sidebar-cache";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { chatRoomService } from "@/lib/services/chat-room.service";

import { UnreadThreadsView } from "./components/unread-threads-view";

/**
 * Every unread Thread across the reader's rooms (SOK-1159). The rooms come
 * from the sidebar's own cached slice, so this adds one Core read: the first
 * page of unread Threads.
 */
export default async function ChatThreadsPage() {
  const session = await getSessionOrRedirect();
  const [roomsPage, initialPage] = await Promise.all([
    getPrivateCachedMembershipVisibleRooms({
      userId: session.user.id,
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    }),
    // A failed read is the view's to retry, not the page's to throw.
    chatRoomService.listUnreadThreads().catch(() => null),
  ]);

  return (
    <UnreadThreadsView
      initialPage={initialPage}
      initialRooms={roomsPage.rooms}
      currentUserId={session.user.id}
    />
  );
}
