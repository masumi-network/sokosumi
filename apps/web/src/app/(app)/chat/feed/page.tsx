import { unstable_rethrow } from "next/navigation";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { chatFeedService } from "@/lib/services/chat-feed.service";

import { FeedView } from "./components/feed-view";

/** The Feed: messages that need the reader, across their rooms, newest first. */
export default async function ChatFeedPage() {
  const session = await getSessionOrRedirect();
  // A failed read shows in the view, not as a page error. A sign-in redirect
  // from the Core client is not a failed read, so it goes on.
  const initialPage = await chatFeedService.getPage().catch((error) => {
    unstable_rethrow(error);
    return null;
  });

  return (
    <FeedView
      initialPage={initialPage}
      currentUserId={session.user.id}
      organizationId={session.session.activeOrganizationId ?? null}
    />
  );
}
