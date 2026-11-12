import { getPrivateCachedMembershipVisibleRooms } from "@/app/components/private-sidebar-cache";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { chatSignalsService } from "@/lib/services/chat-signals.service";

import { CatchUpTabs } from "../components/catch-up-tabs";
import { DecisionsView } from "../components/decisions-view";

/** Catch up's Decisions tab: decisions across the reader's rooms, read or not. */
export default async function ChatCatchUpDecisionsPage() {
  const session = await getSessionOrRedirect();
  const [roomsPage, initialPage] = await Promise.all([
    getPrivateCachedMembershipVisibleRooms({
      userId: session.user.id,
      activeOrganizationId: session.session.activeOrganizationId ?? null,
    }),
    // A failed read shows in the view, not as a page error.
    chatSignalsService.listAllDecisions().catch(() => null),
  ]);

  return (
    <>
      <CatchUpTabs active="decisions" />
      <DecisionsView
        initialPage={initialPage}
        initialRooms={roomsPage.rooms}
        currentUserId={session.user.id}
      />
    </>
  );
}
