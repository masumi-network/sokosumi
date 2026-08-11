import { connection } from "next/server";
import { getPrivateCachedChatListChrome } from "@/app/components/private-sidebar-cache";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";

/**
 * Mobile Chats tab: Personal Assistant (beta-gated) above Channels + DMs
 * (`md:hidden`). Desktop keeps the sidebar list; this route shows nothing
 * meaningful above `md`.
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

  const { chatRoomsPage, archivedChatRoomsPage, members } =
    await getPrivateCachedChatListChrome({
      userId: currentUserId,
      activeOrganizationId,
    });

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
