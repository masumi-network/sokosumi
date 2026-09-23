import { getPrivateCachedMembershipVisibleRooms } from "@/app/components/private-sidebar-cache";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";

import { AllUnreadsView } from "./components/all-unreads-view";

/**
 * Every room with unread, its unread Threads inset (SOK-1159). Built from the
 * rooms the sidebar already reads, so it costs no Core read of its own.
 */
export default async function ChatUnreadsPage() {
  const session = await getSessionOrRedirect();
  const roomsPage = await getPrivateCachedMembershipVisibleRooms({
    userId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId ?? null,
  });

  return (
    <AllUnreadsView
      initialRooms={roomsPage.rooms}
      currentUserId={session.user.id}
    />
  );
}
