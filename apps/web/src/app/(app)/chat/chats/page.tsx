import { connection } from "next/server";
import { mapDbCoworkerToChatCoworker } from "@/app/chat/utils/coworker-utils";
import { getPrivateCachedChatListChrome } from "@/app/components/private-sidebar-cache";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { coworkerService } from "@/lib/services/coworker.service";
import { taskService } from "@/lib/services/task.service";
import { ChatMobileWelcome } from "../components/landing/chat-mobile-welcome";
import { MarkVisit } from "../components/landing/mark-visit.client";

/**
 * How stale the recorded visit must be before a page view counts as a new one.
 * Must match the desktop landing so the two surfaces agree on what "since your
 * last visit" covers.
 */
const LAST_SEEN_REFRESH_MS = 30 * 60 * 1000;

/**
 * Mobile Chats tab: the welcome, then Personal Assistant (beta-gated) above
 * Channels + DMs (`md:hidden`). Desktop keeps the sidebar list; this route
 * shows nothing meaningful above `md`.
 *
 * The welcome lives here rather than on `/chat` because mobile never reaches
 * `/chat` — the bottom nav points at this route, and bare `/chat` redirects
 * here. Desktop gets the same content full-page from `chat/page.tsx`.
 *
 * Instant Nav uses `chats/loading.tsx` while this page streams after
 * `connection()`.
 *
 * Membership-visible rooms come from the same private-cache slice as the app
 * sidebar (`getPrivateCachedChatListChrome`) so cold load does not double-hit
 * Core (SOK-779). Cache key must match sidebar: session user id + active org.
 */
export default async function ChatChatsPage() {
  await connection();

  const session = await getSession();
  const activeOrganizationId = session?.session.activeOrganizationId ?? null;
  const currentUserId = session?.user.id ?? "";

  const [
    { chatRoomsPage, archivedChatRoomsPage, members },
    coworkerRows,
    summary,
  ] = await Promise.all([
    getPrivateCachedChatListChrome({
      userId: currentUserId,
      activeOrganizationId,
    }),
    coworkerService.listCoworkers("chat"),
    // Core reads the window from the stored lastSeenAt itself — a session
    // cookie can lag the column and would silently zero the counts.
    taskService.getActivitySummary({
      // In an org the greeting talks about the team, so count the whole
      // workspace rather than only the caller's own tasks.
      scope: activeOrganizationId ? "workspace" : "owned",
    }),
  ]);

  const shouldAdvanceLastSeen =
    summary !== null &&
    (summary.lastVisitAt === null ||
      Date.now() - summary.lastVisitAt.getTime() >= LAST_SEEN_REFRESH_MS);

  const canDeleteArchivedRooms = Boolean(
    activeOrganizationId &&
      members.some(
        (membership) =>
          membership.organizationId === activeOrganizationId &&
          isOrganizationOwnerOrAdmin(membership.role),
      ),
  );

  const hermesMenuEnabled = isHermesBetaAccessEmail(session?.user.email);

  return (
    <Sheet open>
      {/* No create-FAB clearance: this surface's FAB went away with the
          questionnaire onboarding, and the tab bar has its own spacer. */}
      <div className="md:hidden -m-4 flex min-h-0 flex-1 flex-col overflow-y-auto bg-background">
        <ChatMobileWelcome
          coworkers={coworkerRows.map(mapDbCoworkerToChatCoworker)}
          isOrganizationWorkspace={activeOrganizationId !== null}
          summary={summary}
          userName={session?.user.name ?? null}
        />
        <MarkVisit on="mobile" shouldAdvance={shouldAdvanceLastSeen} />
        <SidebarSeparator className="mb-1" />
        <PersonalAssistantNav enabled={hermesMenuEnabled} />
        {hermesMenuEnabled ? <SidebarSeparator className="-mt-px" /> : null}
        <OrganizationChatList
          key={activeOrganizationId ?? "personal"}
          rooms={chatRoomsPage.rooms}
          roomsNextCursor={chatRoomsPage.nextCursor}
          archivedRooms={archivedChatRoomsPage.rooms}
          archivedRoomsNextCursor={archivedChatRoomsPage.nextCursor}
          currentUserId={currentUserId}
          organizationId={activeOrganizationId}
          canDeleteArchivedRooms={canDeleteArchivedRooms}
          dismissSheetOnNavigate={false}
        />
      </div>
    </Sheet>
  );
}
