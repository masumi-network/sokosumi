"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getActiveRoomIdFromPathname } from "@/components/chat/active-room-id";
import { countChatRoomsWithUnreadAttention } from "@/components/chat/chat-unread-document-title";
import { fetchSidebarRoomCollection } from "@/components/chat/fetch-sidebar-room-collection";
import {
  getLatestMembershipVisibleRoomsSnapshot,
  hasLiveMembershipVisibleRoomsPublisher,
  subscribeMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "@/components/chat/organization-chat-events";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
  rememberRoomRead,
} from "@/components/chat/room-read-overlay";
import { useChatRefreshScheduler } from "@/components/chat/use-chat-refresh-scheduler";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { useSession } from "@/lib/auth/auth.client";
import type { ChatRoom } from "@/lib/clients/generated/core";

/** Poll cadence while the Ably connection is unavailable. */
const CHAT_TAB_UNREAD_FALLBACK_MS = 15_000;

function getInitialRoomsFromSessionSnapshot(): ChatRoom[] {
  const snapshot = getLatestMembershipVisibleRoomsSnapshot();
  if (snapshot == null) {
    return [];
  }
  return applyRoomReadOverlays([...snapshot.rooms]);
}

interface UseChatTabUnreadPresenceResult {
  showUnreadDot: boolean;
  unreadRoomCount: number;
}

export function useChatTabUnreadPresence(): UseChatTabUnreadPresenceResult {
  const pathname = usePathname();
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? "";
  const organizationId = session?.session.activeOrganizationId ?? null;
  const latestAppliedRefreshRef = useRef(0);
  const activeRoomId = getActiveRoomIdFromPathname(pathname);
  const [rooms, setRooms] = useState<ChatRoom[]>(
    getInitialRoomsFromSessionSnapshot,
  );

  // A mounted sidebar list already reads the active collection on the same
  // schedule; mirror its rows rather than run a second reader (desktop).
  // The mirrored rows stay after the list unmounts until the own read lands.
  const sidebarOwnsReads = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    hasLiveMembershipVisibleRoomsPublisher,
    () => false,
  );
  const liveSnapshot = useSyncExternalStore(
    subscribeMembershipVisibleRooms,
    getLatestMembershipVisibleRoomsSnapshot,
    () => null,
  );
  useEffect(() => {
    if (
      !sidebarOwnsReads ||
      !liveSnapshot ||
      liveSnapshot.currentUserId !== currentUserId ||
      liveSnapshot.organizationId !== organizationId
    ) {
      return;
    }
    setRooms([...liveSnapshot.rooms]);
  }, [sidebarOwnsReads, liveSnapshot, currentUserId, organizationId]);

  const unreadRoomCount = countChatRoomsWithUnreadAttention(rooms, {
    activeRoomId,
  });
  const showUnreadDot = unreadRoomCount > 0;

  const scope = currentUserId
    ? `${organizationId ?? ""}:${currentUserId}`
    : null;
  const previousScopeRef = useRef<string | null>(null);

  // Drop the previous workspace's rows before the new GET lands so an
  // in-flight response cannot light the dot for the wrong org (SOK-986).
  useEffect(() => {
    if (previousScopeRef.current === scope) {
      return;
    }
    const previous = previousScopeRef.current;
    previousScopeRef.current = scope;
    if (!scope || previous === null) {
      return;
    }
    latestAppliedRefreshRef.current = 0;
    const snapshot = getLatestMembershipVisibleRoomsSnapshot();
    setRooms(
      snapshot &&
        snapshot.currentUserId === currentUserId &&
        snapshot.organizationId === organizationId
        ? applyRoomReadOverlays([...snapshot.rooms])
        : [],
    );
  }, [scope, currentUserId, organizationId]);

  // Same GET read and scheduling rules as the sidebar's active collection
  // (SOK-986): timer reads pause while hidden or unfocused with one read on
  // return, invalidations read at once, and a slow recovery cadence while
  // Ably is connected.
  const refreshRooms = useCallback(async (isCurrent: () => boolean) => {
    const requestRevision = beginRoomAttentionRefresh();
    const page = await fetchSidebarRoomCollection("active");
    if (
      !isCurrent() ||
      !page ||
      requestRevision < latestAppliedRefreshRef.current
    ) {
      return;
    }
    latestAppliedRefreshRef.current = requestRevision;
    setRooms(reconcileRoomAttention(page.rooms, requestRevision));
  }, []);
  const requestRefresh = useChatRefreshScheduler({
    key: scope && !sidebarOwnsReads ? `${scope}:unread` : null,
    refresh: refreshRooms,
    healthy: useAblyConnectionHealthy(),
    fallbackIntervalMs: CHAT_TAB_UNREAD_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });

  useEffect(() => {
    const handleRoomRead = (event: Event) => {
      const detail = (
        event as CustomEvent<{ room?: ChatRoom; roomId?: string }>
      ).detail;
      if (!detail?.roomId) {
        return;
      }

      if (detail.room) {
        rememberRoomRead(detail.room);
      }

      setRooms((current) =>
        applyRoomReadOverlays(
          current.map((room) => {
            if (room.id !== detail.roomId) return room;
            const updated = detail.room ?? {
              ...room,
              unreadCount: 0,
              unreadMentionCount: 0,
              markedUnread: false,
            };
            if (!detail.room) rememberRoomRead(updated);
            return updated;
          }),
        ),
      );
    };

    window.addEventListener("organization-chat-room-read", handleRoomRead);
    return () => {
      window.removeEventListener("organization-chat-room-read", handleRoomRead);
    };
  }, []);

  useEffect(() => {
    const handleRoomsChanged = (event: Event) => {
      const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
        .detail;
      const removedRoomId = detail?.removedRoomId;
      if (removedRoomId) {
        setRooms((current) =>
          applyRoomReadOverlays(
            current.filter((row) => row.id !== removedRoomId),
          ),
        );
        return;
      }

      const room = detail?.room;
      if (room) {
        setRooms((current) => {
          const without = current.filter((row) => row.id !== room.id);
          return applyRoomReadOverlays([room, ...without]);
        });
        return;
      }

      // Only the active collection feeds the dot, and the open room never
      // counts, so a change in it needs no read here.
      if (detail?.roomId && detail.roomId === activeRoomId) {
        return;
      }
      if (!detail?.collections || detail.collections.includes("active")) {
        requestRefresh();
      }
    };

    window.addEventListener(
      ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      handleRoomsChanged,
    );
    return () => {
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        handleRoomsChanged,
      );
    };
  }, [requestRefresh, activeRoomId]);

  return { showUnreadDot, unreadRoomCount };
}
