import type { SessionUser } from "@sokosumi/utils";
import { Suspense } from "react";
import WorkspaceSwitcherMenu from "@/app/components/workspace-switcher/workspace-switcher-menu.client";
import { loadSidebarChatList } from "./private-sidebar-cache";
import Sidebar from "./sidebar";
import { SidebarChatListSkeleton } from "./sidebar/components/sidebar-chat-list-skeleton";
import { SidebarChatList } from "./sidebar-chat-list.client";
import SidebarDeferredAccount, {
  SidebarAccountChipFallback,
} from "./sidebar-deferred-account";

interface PrivateCachedAppSidebarProps {
  sessionUser: SessionUser;
  activeOrganizationId: string | null;
  adminMenuEnabled: boolean;
  newsletterEnabled: boolean;
}

/**
 * Sync sidebar frame so cold load paints nav immediately after session.
 * Membership-visible rooms stay in a private-cache slice (shared with
 * `/chat`). Credits / vendor-admin / account notice stream. Pending
 * invites are filled by OrganizationChatList's client refresh.
 */
export default function PrivateCachedAppSidebar({
  sessionUser,
  activeOrganizationId,
  adminMenuEnabled,
  newsletterEnabled,
}: PrivateCachedAppSidebarProps) {
  return (
    <Sidebar
      workspaceSwitcher={<WorkspaceSwitcherMenu placement="sidebar" />}
      newsletterEnabled={newsletterEnabled}
      chatList={
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
      }
      accountFooter={
        <Suspense fallback={<SidebarAccountChipFallback />}>
          <SidebarDeferredAccount
            sessionUser={sessionUser}
            activeOrganizationId={activeOrganizationId}
            adminMenuEnabled={adminMenuEnabled}
          />
        </Suspense>
      }
    />
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
