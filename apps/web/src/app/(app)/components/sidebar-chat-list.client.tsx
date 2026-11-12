"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useEffect, useState } from "react";

import { OrganizationChatList } from "@/components/chat/organization-chat-list.client";

import type { SidebarChatListDeferred } from "./private-sidebar-cache";

// One array for every render before the archived rooms arrive: the list
// replaces its rows whenever a collection is a new reference.
const NO_ARCHIVED_ROOMS: ChatRoom[] = [];

// Answers by promise, so a list that mounts again (the phone's sheet reopens)
// starts with what the promise already gave and not one render behind it.
const settledAnswers = new WeakMap<
  Promise<SidebarChatListDeferred>,
  SidebarChatListDeferred
>();

interface SidebarChatListProps {
  rooms: ChatRoom[];
  /** Archived rooms and the owner/admin flag, read beside the rooms. */
  deferred: Promise<SidebarChatListDeferred>;
  currentUserId: string;
  organizationId: string | null;
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
}: SidebarChatListProps) {
  const [settled, setSettled] = useState<SidebarChatListDeferred | null>(
    () => settledAnswers.get(deferred) ?? null,
  );
  useEffect(() => {
    let current = true;
    deferred.then(
      (value) => {
        settledAnswers.set(deferred, value);
        if (current) setSettled(value);
      },
      // The read failed or the stream closed before the answer arrived. The
      // rows stay, without the Archived section and the owner/admin menus,
      // until the layout is next refreshed. No refresh from here: it re-runs
      // the whole app frame, which fails closed when Core is slow.
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [deferred]);

  return (
    <OrganizationChatList
      rooms={rooms}
      archivedRooms={settled?.archivedRooms ?? NO_ARCHIVED_ROOMS}
      currentUserId={currentUserId}
      organizationId={organizationId}
      isOrgOwnerOrAdmin={settled?.isOrgOwnerOrAdmin ?? false}
      withChatsHeading
    />
  );
}
