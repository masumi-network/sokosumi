"use client";

import type { ChatRoom, ChatRoomInvitation } from "@sokosumi/core-client";
import { useState, useSyncExternalStore } from "react";
import { useChatListStoreBinding } from "@/hooks/effects/use-chat-list-store-binding";
import { useMembershipVisibleRoomsPublisher } from "@/hooks/effects/use-membership-visible-rooms-publisher";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";

import { createChatListStore } from "./chat-list-store";
import { applyRoomReadOverlays } from "./room-read-overlay";

interface UseOrganizationChatRoomsOptions {
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
  pendingInvitations: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  paintOnly: boolean;
}

/**
 * Holds the chat sidebar's three room collections: the prop hand-off from RSC
 * and every path that can change the rows behind the reader's back (the
 * scheduled recovery read, foreground return, room-read, and the rooms-changed
 * control event). Each collection is its own scheduled read (SOK-986): an
 * invalidation naming only `archived` never re-reads the other two, timer
 * reads pause while the tab is hidden or unfocused, and a healthy Ably
 * connection slows recovery to once a minute. An invalidation still reads
 * while away: the live rows feed the tab title's unread count, which is
 * the one signal a reader who is not looking at the tab gets.
 *
 * Rendering and room actions live in the components. Room actions still write
 * the archived and pending collections through the setters this returns; the
 * live rows are the exception, because the read overlay has to be reapplied on
 * every write and that rule stays here. `paintOnly` mounts (SOK-903 instant
 * soft-nav) skip every subscription, so they paint the props they were given
 * and nothing else.
 *
 * The live rows are published to the membership-visible store on every change.
 * Chat surfaces that render without mounting the sidebar read them back from
 * there, the tab-title unread count among them.
 *
 * The three collections must keep their identity across renders. A new array
 * reference means new props, and the rows are replaced, so a caller passing a
 * fresh `[]` literal per render loops (React #301). That is what the list's
 * stable empty invitations default is for.
 */
export function useOrganizationChatRooms({
  rooms,
  archivedRooms,
  pendingInvitations,
  currentUserId,
  organizationId,
  paintOnly,
}: UseOrganizationChatRoomsOptions) {
  const healthy = useAblyConnectionHealthy();
  const [store] = useState(() =>
    createChatListStore({
      rooms,
      archivedRooms,
      pendingInvitations,
      currentUserId,
      organizationId,
      paintOnly,
      healthy,
    }),
  );

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  // Derive rows from changed RSC props until the layout effect hands them to
  // the store, so render and passive publishers never pair old rows with a
  // new RSC seed or publish twice when the store adopts the same array.
  const overlaidRooms =
    rooms !== snapshot.sourceRooms ? applyRoomReadOverlays(rooms) : undefined;
  const roomRows = overlaidRooms ?? snapshot.roomRows;
  const archivedRows =
    archivedRooms !== snapshot.sourceArchivedRooms
      ? archivedRooms
      : snapshot.archivedRows;
  const pendingRows =
    pendingInvitations !== snapshot.sourcePendingInvitations
      ? pendingInvitations
      : snapshot.pendingRows;

  useChatListStoreBinding({
    store,
    rooms,
    overlaidRooms,
    archivedRooms,
    pendingInvitations,
    currentUserId,
    organizationId,
    paintOnly,
    healthy,
  });

  useMembershipVisibleRoomsPublisher({
    rooms: roomRows,
    organizationId,
    currentUserId,
    sourceRooms: rooms,
    enabled: !paintOnly,
  });

  return {
    roomRows,
    archivedRows,
    pendingRows,
    setArchivedRows: store.setArchivedRows,
    setPendingRows: store.setPendingRows,
    upsertRoomToTop: store.upsertRoomToTop,
    replaceRoom: store.replaceRoom,
    replaceAllRooms: store.replaceAllRooms,
    applyPinnedOrder: store.applyPinnedOrder,
  };
}
