"use client";

import type { ChatRoom } from "@sokosumi/core-client";

import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { useSidebarChatListDeferred } from "@/hooks/effects/use-sidebar-chat-list-deferred";
import type { SidebarChatListDeferred } from "./private-sidebar-cache";
import { SidebarMobileChatsDestination } from "./sidebar/components/sidebar-context-panel";

// One array for every render before the archived rooms arrive: the list
// replaces its rows whenever a collection is a new reference.
const NO_ARCHIVED_ROOMS: ChatRoom[] = [];

interface SidebarChatListProps {
  rooms: ChatRoom[];
  /** Archived rooms and the owner/admin flag, read beside the rooms. */
  deferred: Promise<SidebarChatListDeferred>;
  currentUserId: string;
  organizationId: string | null;
  /**
   * `sidebar` (default) closes the sheet on
   * navigate. `page` is the phone's `/chat` page: titled Chats already and
   * outside any sheet.
   */
  variant?: "sidebar" | "page";
  directFooter?: React.ReactNode;
}

/**
 * The sidebar's chat list, mounted once with the rooms. The Archived section
 * and the owner/admin menus arrive later and are handed to the same mount, so
 * the list keeps its state and reads Core once. A refreshed promise keeps
 * what it replaces on screen until it settles.
 *
 * An effect, not `use()`: `use()` would suspend the rows this exists to show.
 */
export function SidebarChatList({
  rooms,
  deferred,
  currentUserId,
  organizationId,
  variant = "sidebar",
  directFooter,
}: SidebarChatListProps) {
  const settled = useSidebarChatListDeferred(deferred);

  return (
    <OrganizationChatList
      rooms={rooms}
      archivedRooms={settled?.archivedRooms ?? NO_ARCHIVED_ROOMS}
      currentUserId={currentUserId}
      organizationId={organizationId}
      isOrgOwnerOrAdmin={settled?.isOrgOwnerOrAdmin ?? false}
      directFooter={directFooter}
      afterCatchUp={
        variant === "sidebar" ? <SidebarMobileChatsDestination /> : null
      }
      dismissSheetOnNavigate={variant === "sidebar"}
    />
  );
}
