"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import {
  getLatestMembershipVisibleRoomsSnapshot,
  hasLiveMembershipVisibleRoomsPublisher,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import {
  useOrganizationChatRoomRead,
  useOrganizationChatRoomsChanged,
} from "@/components/chat/organization-chat-events";
import { keepRoomUnreadState } from "@/components/chat/room-attention";
import {
  applyRoomReadOverlays,
  reconcileRoomAttention,
} from "@/components/chat/room-read-overlay";
import { useLatestRef } from "@/hooks/effects/use-latest-ref";
import { useLiveChatRoomsOwnershipSettled } from "@/hooks/effects/use-live-chat-rooms-ownership-settled";
import { useLiveChatRoomsReader } from "@/hooks/effects/use-live-chat-rooms-reader";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { useSession } from "@/lib/auth/auth.client";

/** The user and workspace a list of rooms belongs to. */
function roomsScope(
  organizationId: string | null,
  userId: string,
): string | null {
  return userId ? `${organizationId ?? ""}:${userId}` : null;
}

/** Rows with the scope they were read in, so another scope's never show. */
interface HeldRooms {
  scope: string | null;
  rooms: ChatRoom[] | null;
}

function getInitialRoomsFromSessionSnapshot(): HeldRooms {
  const snapshot = getLatestMembershipVisibleRoomsSnapshot();
  if (snapshot == null) {
    return { scope: null, rooms: null };
  }
  return {
    scope: roomsScope(snapshot.organizationId, snapshot.currentUserId),
    rooms: applyRoomReadOverlays([...snapshot.rooms]),
  };
}

/**
 * The reader's live membership-visible rooms, for chat surfaces that need
 * what is unread without mounting the sidebar list: the Chats tab's unread
 * dot, and the Threads view (SOK-1159).
 *
 * While a sidebar list is mounted it already reads the active collection, so
 * this mirrors its rows. Without one (the phone, away from the Chats list) it
 * runs the same read on the same schedule itself, and applies the same room
 * read and rooms-changed events the list does.
 *
 * Null until a first read or a session snapshot says what the rooms are, so
 * a reader in no room (an empty list) is not mistaken for one not read yet.
 */
export function useLiveChatRooms(): ChatRoom[] | null {
  return useLiveChatRoomsRead().rooms;
}

/**
 * `useLiveChatRooms`, plus whether this user and workspace's first read
 * failed with no rows held, so a caller can say so while the reader retries.
 */
export function useLiveChatRoomsRead(): {
  rooms: ChatRoom[] | null;
  failed: boolean;
} {
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? "";
  const organizationId = session?.session.activeOrganizationId ?? null;
  const latestAppliedRefreshRef = useRef(0);
  const [held, setHeld] = useState<HeldRooms>(
    getInitialRoomsFromSessionSnapshot,
  );
  const scope = roomsScope(organizationId, currentUserId);
  // Read by the async refresh, which keeps one identity across scopes.
  const scopeRef = useLatestRef(scope);
  // The scope whose latest own read failed; cleared by a read that answers.
  const [failedScope, setFailedScope] = useState<string | null>(null);
  // Updates a held list in place; a list not read yet stays unread.
  const updateRooms = useCallback(
    (apply: (rooms: ChatRoom[]) => ChatRoom[]) =>
      setHeld((current) =>
        current.rooms === null
          ? current
          : { ...current, rooms: apply(current.rooms) },
      ),
    [],
  );

  // A mounted sidebar list already reads the active collection on the same
  // schedule; mirror its rows rather than run a second reader (desktop).
  // The mirrored rows stay after the list unmounts until the own read lands.
  const sidebarOwnsReads = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    hasLiveMembershipVisibleRoomsPublisher,
    () => false,
  );
  // The desktop sidebar registers as the reader from an effect, often in a
  // later streamed commit than this hook's. Reading at once would read the
  // same collection twice, so on desktop this waits a moment for it; on a
  // phone there is no sidebar to wait for.
  const ownershipSettled = useLiveChatRoomsOwnershipSettled();
  const liveSnapshot = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    getLatestMembershipVisibleRoomsSnapshot,
    () => null,
  );

  const [trackedScope, setTrackedScope] = useState<string | null>(scope);

  const mirroredSnapshot =
    sidebarOwnsReads &&
    liveSnapshot &&
    liveSnapshot.currentUserId === currentUserId &&
    liveSnapshot.organizationId === organizationId
      ? liveSnapshot
      : null;
  const [syncedSnapshot, setSyncedSnapshot] = useState<
    typeof liveSnapshot | null
  >(null);
  if (mirroredSnapshot && mirroredSnapshot !== syncedSnapshot) {
    setSyncedSnapshot(mirroredSnapshot);
    setHeld({
      scope,
      rooms: applyRoomReadOverlays([...mirroredSnapshot.rooms]),
    });
  } else if (!mirroredSnapshot && syncedSnapshot !== null) {
    setSyncedSnapshot(null);
  }

  // Drop the previous workspace's rows before the new GET lands so an
  // in-flight response cannot light the dot for the wrong org (SOK-986).
  // Runs after the mirror so a matching snapshot's local read overlays win.
  if (trackedScope !== scope) {
    const previous = trackedScope;
    setTrackedScope(scope);
    if (scope && previous !== null) {
      latestAppliedRefreshRef.current = 0;
      const snapshot = getLatestMembershipVisibleRoomsSnapshot();
      setHeld({
        scope,
        rooms:
          snapshot &&
          snapshot.currentUserId === currentUserId &&
          snapshot.organizationId === organizationId
            ? applyRoomReadOverlays([...snapshot.rooms])
            : null,
      });
    }
  }

  // Same GET read and scheduling rules as the sidebar's active collection
  // (SOK-986): timer reads pause while hidden or unfocused with one read on
  // return, invalidations read at once, and a slow recovery cadence while
  // Ably is connected.
  const requestRefresh = useLiveChatRoomsReader({
    scope: scope && ownershipSettled && !sidebarOwnsReads ? scope : null,
    healthy: useAblyConnectionHealthy(),
    onAnswer: ({ scope: requestScope, revision: requestRevision, page }) => {
      // The ref moves in the layout phase, before the scheduler's passive
      // cleanup makes `isCurrent` false, so an answer can land between them.
      if (scopeRef.current !== requestScope) return;
      if (!page) {
        setFailedScope(requestScope);
        return;
      }
      if (requestRevision < latestAppliedRefreshRef.current) return;
      setFailedScope(null);
      latestAppliedRefreshRef.current = requestRevision;
      setHeld({
        scope: requestScope,
        rooms: reconcileRoomAttention(page.rooms, requestRevision),
      });
    },
    onSeed: ({ scope: answerScope, revision: answerRevision, rows }) => {
      if (scopeRef.current !== answerScope) return;
      if (answerRevision <= latestAppliedRefreshRef.current) return;
      setFailedScope(null);
      latestAppliedRefreshRef.current = answerRevision;
      setHeld({
        scope: answerScope,
        rooms: applyRoomReadOverlays([...rows]),
      });
    },
  });

  useOrganizationChatRoomRead((apply) => updateRooms(apply));

  useOrganizationChatRoomsChanged({
    onRemoved: (removedRoomId) =>
      updateRooms((current) =>
        applyRoomReadOverlays(
          current.filter((row) => row.id !== removedRoomId),
        ),
      ),
    onRoom: (room) =>
      // The answers that land here do not count what is unread, so the
      // room keeps what the title already counted for it.
      // One room is not the list; the first read still decides it.
      updateRooms((current) => {
        const held = current.find((row) => row.id === room.id);
        const without = current.filter((row) => row.id !== room.id);
        return applyRoomReadOverlays([
          keepRoomUnreadState(held, room),
          ...without,
        ]);
      }),
    onInvalidated: (collections) => {
      // Only the active collection holds what is unread.
      if (!collections || collections.includes("active")) {
        requestRefresh();
      }
    },
  });

  // Rows read for another user or workspace never show, even before this
  // scope's own read lands.
  const rooms = scope !== null && held.scope === scope ? held.rooms : null;
  return {
    rooms,
    failed: rooms === null && scope !== null && failedScope === scope,
  };
}
