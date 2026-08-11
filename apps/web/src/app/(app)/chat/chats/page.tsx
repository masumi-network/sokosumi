import { connection } from "next/server";
import { LIST_MOBILE_CREATE_FAB_CLEARANCE } from "@/app/components/mobile-create-fab-geometry";
import { getPrivateCachedChatListChrome } from "@/app/components/private-sidebar-cache";
import PersonalAssistantNav from "@/app/components/sidebar/components/personal-assistant-nav.client";
import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { Sheet } from "@/components/ui/sheet";
import { SidebarSeparator } from "@/components/ui/sidebar";
import { getSession } from "@/lib/auth/auth.server";
import { isOrganizationOwnerOrAdmin } from "@/lib/helpers/organization-member";
import { isHermesBetaAccessEmail } from "@/lib/hermes/beta-access";
import { cn } from "@/lib/utils";

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
      {/*
        Grow with content — do not height-lock with min-h-0 + overflow-y-auto.
        AppMobileChrome's in-flow tab-bar spacer must sit after the last row in
        main's scroll; padding on a nested overflow flex child does not clear
        the fixed bottom nav (last DM was clipped).
      */}
      <div
        className={cn(
          "md:hidden -m-4 flex flex-1 flex-col bg-background",
          LIST_MOBILE_CREATE_FAB_CLEARANCE,
        )}
      >
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
