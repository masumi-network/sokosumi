"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";

import { fetchSidebarRoomCollection } from "./fetch-sidebar-room-collection";
import {
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
  type OrganizationChatRoomsChangedDetail,
} from "./organization-chat-events";
import { roomAttentionAfterRead, roomUnreadReads } from "./room-attention";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
  rememberRoomRead,
} from "./room-read-overlay";
import { useChatRefreshScheduler } from "./use-chat-refresh-scheduler";

/** At most one read per window, so a busy room costs less than its messages. */
const ELSEWHERE_READ_WINDOW_MS = 2_000;

const NOTHING_UNREAD = {
  unreadCount: 0,
  channelUnreadCount: 0,
  threadUnreadCount: 0,
  unreadThreadCount: 0,
  unreadThreadMentionCount: 0,
  unreadThreads: [],
  unreadMentionCount: 0,
  unreadNeedsYouCount: 0,
  markedUnread: false,
} satisfies Partial<ChatRoom>;

/**
 * Core's list, with the open room's row where it stood. Core stops listing a
 * room once it is read, and the row must not vanish under the reader's cursor.
 */
function keepOpenRoomRow(
  current: readonly ChatRoom[],
  listed: ChatRoom[],
  openRoomId: string | null,
): ChatRoom[] {
  const index = current.findIndex((room) => room.id === openRoomId);
  if (index < 0 || listed.some((room) => room.id === openRoomId)) {
    return listed;
  }
  return [
    ...listed.slice(0, index),
    { ...current[index], ...NOTHING_UNREAD },
    ...listed.slice(index),
  ];
}

/**
 * The unread rooms of the reader's other workspaces, in Core's order, for the
 * Elsewhere rows (ADR-0061). No timer reads: Core tells each member's control
 * channel about every message, and about the reader's own reads, so this reads
 * on that, on mount, and when a lost connection comes back.
 *
 * A room the reader has read or muted stays held until the next read, but only
 * the open room is answered: that is what takes a read row away once the reader
 * moves on.
 *
 * `answered` turns true once the first read has come back, listed or failed, so
 * a caller can tell "nothing unread" from "not asked yet".
 */
export function useElsewhereRooms({
  currentUserId,
  organizationId,
  activeRoomId,
  paintOnly,
}: {
  currentUserId: string;
  organizationId: string | null;
  activeRoomId: string | null;
  paintOnly: boolean;
}) {
  const [heldRooms, setHeldRooms] = useState<ChatRoom[]>([]);
  const [answered, setAnswered] = useState(false);
  const scope = paintOnly
    ? null
    : `${organizationId ?? ""}:${currentUserId}:elsewhere`;
  // A room of the workspace just left is not "elsewhere" any more, and one of
  // the workspace just entered must not show twice.
  const [prevScope, setPrevScope] = useState(scope);
  if (scope !== prevScope) {
    setPrevScope(scope);
    setHeldRooms([]);
    setAnswered(false);
  }
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;

  const refresh = useCallback(async (isCurrent: () => boolean) => {
    const requestRevision = beginRoomAttentionRefresh();
    const rooms = await fetchSidebarRoomCollection("elsewhere");
    if (!isCurrent()) return;
    setAnswered(true);
    if (!rooms) return;
    const listed = reconcileRoomAttention(rooms, requestRevision);
    setHeldRooms((current) =>
      keepOpenRoomRow(current, listed, activeRoomIdRef.current),
    );
  }, []);
  const healthy = useAblyConnectionHealthy();
  const requestRead = useChatRefreshScheduler({
    key: scope,
    refresh,
    healthy,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });

  useEffect(() => {
    if (paintOnly) {
      return;
    }
    let timer: number | undefined;
    let lastReadAt = 0;

    function read() {
      timer = undefined;
      lastReadAt = Date.now();
      requestRead();
    }

    const handleRoomsChanged = (event: Event) => {
      const detail = (event as CustomEvent<OrganizationChatRoomsChangedDetail>)
        .detail;
      const removedRoomId = detail?.removedRoomId;
      if (removedRoomId) {
        setHeldRooms((current) =>
          current.filter((room) => room.id !== removedRoomId),
        );
        return;
      }
      // Only the active collection's changes hold what is unread. A room handed
      // over whole is one the reader just joined or edited here.
      if (
        detail?.room ||
        (detail?.collections && !detail.collections.includes("active"))
      ) {
        return;
      }
      if (timer !== undefined) return;
      // The first message of a quiet spell reads at once; a burst waits.
      const wait = lastReadAt + ELSEWHERE_READ_WINDOW_MS - Date.now();
      if (wait <= 0) {
        read();
      } else {
        timer = window.setTimeout(read, wait);
      }
    };

    window.addEventListener(
      ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      handleRoomsChanged,
    );
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(
        ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
        handleRoomsChanged,
      );
    };
  }, [paintOnly, requestRead]);

  useEffect(() => {
    if (paintOnly) {
      return;
    }

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
      setHeldRooms((current) =>
        applyRoomReadOverlays(
          current.map((room) => {
            if (room.id !== detail.roomId) return room;
            if (detail.room) return withWorkspaceOf(room, detail.room);
            const updated = { ...room, ...roomAttentionAfterRead(room) };
            rememberRoomRead(updated);
            return updated;
          }),
        ),
      );
    };

    window.addEventListener("organization-chat-room-read", handleRoomRead);
    return () => {
      window.removeEventListener("organization-chat-room-read", handleRoomRead);
    };
  }, [paintOnly]);

  const replaceRoom = useCallback((updated: ChatRoom) => {
    if (updated.markedUnread) {
      rememberRoomRead(updated);
    }
    setHeldRooms((current) =>
      applyRoomReadOverlays(
        current.map((room) =>
          room.id === updated.id ? withWorkspaceOf(room, updated) : room,
        ),
      ),
    );
  }, []);

  const rooms = heldRooms.filter((room) => {
    const { readRoom, lookThreads } = roomUnreadReads(room);
    return readRoom || lookThreads || room.id === activeRoomId;
  });

  return { rooms, replaceRoom, answered };
}

/** A room action's answer does not load the Organization's name the row shows. */
function withWorkspaceOf(held: ChatRoom, updated: ChatRoom): ChatRoom {
  return { ...updated, organizationName: held.organizationName };
}
