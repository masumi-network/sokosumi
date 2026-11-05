import { getSessionOrRedirect } from "@/lib/auth/auth.server";

import { CatchUpTabs } from "./components/catch-up-tabs";
import { CatchUpView } from "./components/catch-up-view";

/**
 * One place for everything the reader missed. This tab: the written "while
 * you were away" across their rooms (chat signals) and the unread rooms of
 * their other workspaces; the unread Threads are the other tab.
 */
export default async function ChatCatchUpPage() {
  const session = await getSessionOrRedirect();
  return (
    <>
      <CatchUpTabs active="overview" />
      <CatchUpView
        currentUserId={session.user.id}
        organizationId={session.session.activeOrganizationId ?? null}
      />
    </>
  );
}
