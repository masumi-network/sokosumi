"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useState } from "react";

import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";
import { chatQueryKeys, splitChatQueryKey } from "@/queries/chat";
import { useScopedQuery } from "@/queries/scoped-queries";

import type { SidebarChatListDeferred } from "./private-sidebar-cache";

// One array for every render before the archived rooms arrive: the list
// replaces its rows whenever a collection is a new reference.
const NO_ARCHIVED_ROOMS: ChatRoom[] = [];

// Stable identity per deferred server promise so remounts reuse the cached
// query result and replaced promises land on their own inactive key.
let nextDeferredId = 0;
const deferredIds = new WeakMap<Promise<SidebarChatListDeferred>, number>();

function getDeferredId(promise: Promise<SidebarChatListDeferred>): number {
  let id = deferredIds.get(promise);
  if (id === undefined) {
    id = ++nextDeferredId;
    deferredIds.set(promise, id);
  }
  return id;
}

interface SidebarChatListProps {
  rooms: ChatRoom[];
  /** Archived rooms and the owner/admin flag, read beside the rooms. */
  deferred: Promise<SidebarChatListDeferred>;
  currentUserId: string;
  organizationId: string | null;
  /**
   * `sidebar` (default) heads the list with Chats and closes the sheet on
   * navigate. `page` is the phone's `/chat` page: titled Chats already and
   * outside any sheet.
   */
  variant?: "sidebar" | "page";
}

/**
 * The sidebar's chat list, mounted once with the rooms. The Archived section
 * and the owner/admin menus arrive later and are handed to the same mount, so
 * the list keeps its state and reads Core once. A refreshed promise keeps
 * what it replaces on screen until it settles.
 */
export function SidebarChatList({
  rooms,
  deferred,
  currentUserId,
  organizationId,
  variant = "sidebar",
}: SidebarChatListProps) {
  const scopeKey = `${currentUserId}:${organizationId ?? ""}`;
  const deferredId = getDeferredId(deferred);
  const { data } = useScopedQuery({
    ...splitChatQueryKey(
      chatQueryKeys.sidebarDeferred(
        { userId: currentUserId, workspaceId: organizationId },
        deferredId,
      ),
    ),
    queryFn: () => deferred,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const [lastSettled, setLastSettled] = useState<{
    scopeKey: string;
    value: SidebarChatListDeferred;
  } | null>(null);
  if (
    data !== undefined &&
    (lastSettled?.scopeKey !== scopeKey || lastSettled.value !== data)
  ) {
    setLastSettled({ scopeKey, value: data });
  }
  const settled =
    data ?? (lastSettled?.scopeKey === scopeKey ? lastSettled.value : null);

  return (
    <OrganizationChatList
      rooms={rooms}
      archivedRooms={settled?.archivedRooms ?? NO_ARCHIVED_ROOMS}
      currentUserId={currentUserId}
      organizationId={organizationId}
      isOrgOwnerOrAdmin={settled?.isOrgOwnerOrAdmin ?? false}
      withChatsHeading={variant === "sidebar"}
      dismissSheetOnNavigate={variant === "sidebar"}
    />
  );
}
