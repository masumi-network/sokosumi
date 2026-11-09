import { getPrivateCachedMembershipVisibleRooms } from "@/app/components/private-sidebar-cache";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { chatRoomService } from "@/lib/services/chat-room.service";

import { CatchUpTabs } from "../components/catch-up-tabs";
import { SavedMessagesView } from "../components/saved-messages-view";

/** Catch up's Saved tab: the messages the reader saved for later. */
export default async function ChatCatchUpSavedPage() {
  const session = await getSessionOrRedirect();
  const [roomsPage, initialPage] = await Promise.all([
    getPrivateCachedMembershipVisibleRooms({
      userId: session.user.id,
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    }),
    // A failed read shows in the view, not as a page error.
    chatRoomService.listSavedMessages().catch(() => null),
  ]);

  return (
    <>
      <CatchUpTabs active="saved" />
      <SavedMessagesView
        initialPage={initialPage}
        initialRooms={roomsPage.rooms}
        currentUserId={session.user.id}
      />
    </>
  );
}
