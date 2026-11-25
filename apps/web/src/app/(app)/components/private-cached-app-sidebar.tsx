import type { SessionUser } from "@sokosumi/utils";
import { Suspense } from "react";
import WorkspaceSwitcherMenu from "@/app/components/workspace-switcher/workspace-switcher-menu.client";
import Sidebar from "./sidebar";
import { SidebarChatSlot } from "./sidebar/components/sidebar-chat-slot";
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
        <SidebarChatSlot
          sessionUser={sessionUser}
          activeOrganizationId={activeOrganizationId}
        />
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
