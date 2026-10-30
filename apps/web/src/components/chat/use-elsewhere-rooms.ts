"use client";

import type { ChatRoom, StarredChatRoomOrder } from "@sokosumi/core-client";
import {
  type QueryFunctionContext,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { useSession } from "@/lib/auth/auth.client";

import { withPinnedOrder } from "./chat-room-activity-sort";
import { fetchSidebarRoomCollection } from "./fetch-sidebar-room-collection";
import {
  subscribeOrganizationChatRoomRead,
  subscribeOrganizationChatRoomsChanged,
} from "./organization-chat-events";
import { roomHasUnread } from "./room-attention";
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

const NO_ROOMS: ChatRoom[] = [];

const ELSEWHERE_ROOMS_KEY = ["chat-elsewhere-rooms"] as const;

/** When the reader last pinned, unpinned or reordered here. */
let pinsChangedAtRevision = 0;

async function readElsewhereRooms({
  client,
  queryKey,
}: QueryFunctionContext): Promise<ChatRoom[]> {
  const requestRevision = beginRoomAttentionRefresh();
  const rooms = await fetchSidebarRoomCollection("elsewhere");
  if (!rooms) {
    throw new Error("Failed to read the rooms of other workspaces");
  }
  // This read predates the change and must not undo it on screen. The change
  // reads again once Core holds it.
  const current = client.getQueryData<ChatRoom[]>(queryKey);
  if (current && requestRevision < pinsChangedAtRevision) {
    return current;
  }
  return reconcileRoomAttention(rooms, requestRevision);
}

/**
 * Keeps the rooms of other workspaces current for every surface showing them.
 * Mounted once beside the QueryClient, so one message costs one read per tab
 * however many of them are up.
 *
 * No timer reads: Core tells each member's control channel about every message,
 * so this reads on that, when the reader returns to the window, and when a lost
 * connection comes back. The window is how a read in another tab or on another
 * device arrives, because it sends no event; a read in this tab clears locally.
 */
export function ElsewhereRoomsLive(): null {
  const queryClient = useQueryClient();
  const requestRead = useChatRefreshScheduler({
    key: "elsewhere",
    refresh: () =>
      queryClient.invalidateQueries({ queryKey: ELSEWHERE_ROOMS_KEY }),
    healthy: useAblyConnectionHealthy(),
    refreshOnRecovery: true,
    refreshOnForeground: true,
  });

  useMountEffect(() => {
    let timer: number | undefined;
    let lastReadAt = 0;

    function read() {
      timer = undefined;
      lastReadAt = Date.now();
      requestRead();
    }

    function updateRooms(update: (current: ChatRoom[]) => ChatRoom[]) {
      queryClient.setQueriesData<ChatRoom[]>(
        { queryKey: ELSEWHERE_ROOMS_KEY },
        (current) => current && update(current),
      );
    }

    const stopRoomsChanged = subscribeOrganizationChatRoomsChanged({
      onRemoved: (removedRoomId) =>
        updateRooms((current) =>
          current.filter((room) => room.id !== removedRoomId),
        ),
      // A room handed over whole is one the reader just joined or edited here,
      // so no `onRoom`.
      onInvalidated: (collections) => {
        // Only the active collection's changes hold what is unread.
        if (collections && !collections.includes("active")) {
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
      },
    });
    const stopRoomRead = subscribeOrganizationChatRoomRead(
      updateRooms,
      withWorkspaceOf,
    );
    return () => {
      window.clearTimeout(timer);
      stopRoomsChanged();
      stopRoomRead();
    };
  });

  return null;
}

/**
 * The unread ones, for the signals mounted outside the chat list. These count
 * what is unread, so none of them holds a read row for the open room, and a read
 * pin adds nothing.
 */
export function useLiveElsewhereRooms(): ChatRoom[] {
  const { data: session } = useSession();
  const { rooms } = useElsewhereRooms({
    currentUserId: session?.user.id ?? null,
    organizationId: session?.session.activeOrganizationId ?? null,
    enabled: true,
  });
  return rooms;
}

interface UseElsewhereRoomsOptions {
  currentUserId: string | null;
  organizationId: string | null;
  /** The open room, whose row stays if it was showing when the room opened. */
  activeRoomId?: string | null;
  /** Whether this surface reads the rooms, or only paints. */
  enabled: boolean;
}

/** The row an open room keeps, decided once per room opened. */
interface OpenRoomHold {
  key: string;
  room: ChatRoom | null;
  /** Where it stood, for when Core stops listing it. */
  index: number;
}

/**
 * Core's list, with the open room's row where it stood. Core stops listing a
 * room once it is read, and the row must not vanish under the reader's cursor.
 */
function keepHeldRow(
  listed: ChatRoom[],
  held: OpenRoomHold | null,
): ChatRoom[] {
  const room = held?.room;
  if (!held || !room || listed.some(({ id }) => id === room.id)) {
    return listed;
  }
  return [
    ...listed.slice(0, held.index),
    { ...room, ...NOTHING_UNREAD },
    ...listed.slice(held.index),
  ];
}

/**
 * The reader's rooms of other workspaces that hold something unread or are
 * pinned, in Core's order: one shared query, read on mount and kept current by
 * `ElsewhereRoomsLive`. `pinnedRooms` go to Pinned (ADR-0062). `rooms` is what is
 * unread, pinned or not, for Catch up's page and the signals, and
 * `selectElsewhereRows` takes the Elsewhere rows from it (ADR-0061).
 *
 * A row showing when its room opened stays until the reader leaves, mark cleared
 * once read. A room with no row then gets none to keep: if a message lists it
 * before the read lands, it leaves when the read does, because nothing is added
 * while everything is read. A Pinned room has a row of its own, so it holds none.
 *
 * `answered` turns true once the first read has come back, listed or failed, so
 * a caller can tell "nothing unread" from "not asked yet".
 */
export function useElsewhereRooms({
  currentUserId,
  organizationId,
  activeRoomId = null,
  enabled,
}: UseElsewhereRoomsOptions) {
  const queryClient = useQueryClient();
  // A room of the workspace just left is not "elsewhere" any more, and one of
  // the workspace just entered must not show twice.
  const queryKey = [...ELSEWHERE_ROOMS_KEY, currentUserId, organizationId];
  const { data: listed = NO_ROOMS, isFetched: answered } = useQuery({
    queryKey,
    queryFn: readElsewhereRooms,
    enabled: enabled && currentUserId !== null,
    // `ElsewhereRoomsLive` decides when to read, and asks by invalidating.
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    // The fetch retries a stall itself. Offline it fails, which is an answer.
    retry: false,
    networkMode: "always",
  });

  // shortcut: the hold lives in this surface, so a phone sheet reopened during a visit no longer lists a read row, share it across surfaces if that reads as a bug
  const [hold, setHold] = useState<OpenRoomHold | null>(null);
  const holdKey = `${organizationId ?? ""}:${currentUserId}:${activeRoomId}`;
  if (answered && hold?.key !== holdKey) {
    const index = listed.findIndex(
      (room) =>
        room.id === activeRoomId &&
        room.starredAt == null &&
        roomHasUnread(room),
    );
    setHold({ key: holdKey, room: listed[index] ?? null, index });
  }
  const held = hold?.key === holdKey ? hold : null;

  useMountEffect(() =>
    subscribeOrganizationChatRoomsChanged({
      onRemoved: (removedRoomId) =>
        setHold((current) =>
          current?.room?.id === removedRoomId
            ? { ...current, room: null }
            : current,
        ),
    }),
  );

  function replaceRoom(updated: ChatRoom) {
    if (updated.markedUnread) {
      rememberRoomRead(updated);
    }
    const before = queryClient
      .getQueryData<ChatRoom[]>(queryKey)
      ?.find((room) => room.id === updated.id);
    if ((before?.starredAt == null) !== (updated.starredAt == null)) {
      pinsChangedAtRevision = beginRoomAttentionRefresh();
    }
    queryClient.setQueryData<ChatRoom[]>(
      queryKey,
      (current) =>
        current &&
        applyRoomReadOverlays(
          // A held row Core has stopped listing goes to Pinned with the rest.
          !before && updated.starredAt != null
            ? [...current, updated]
            : current.map((room) =>
                room.id === updated.id ? withWorkspaceOf(room, updated) : room,
              ),
        ),
    );
    setHold((current) =>
      current?.room?.id === updated.id
        ? {
            ...current,
            // Pinned, it has its row there. Unpinned later and read, it has none.
            room:
              updated.starredAt == null
                ? withWorkspaceOf(current.room, updated)
                : null,
          }
        : current,
    );
  }

  /**
   * A reorder's new sort keys, for the pinned rooms held here, in every
   * workspace's copy.
   */
  function applyPinnedOrder(order: StarredChatRoomOrder[]) {
    pinsChangedAtRevision = beginRoomAttentionRefresh();
    queryClient.setQueriesData<ChatRoom[]>(
      { queryKey: ELSEWHERE_ROOMS_KEY },
      (current) => current && withPinnedOrder(current, order),
    );
  }

  function readAgain() {
    void queryClient.invalidateQueries({ queryKey: ELSEWHERE_ROOMS_KEY });
  }

  const rooms = keepHeldRow(listed, held).filter(
    (room) => roomHasUnread(room) || room.id === held?.room?.id,
  );
  const pinnedRooms = listed.filter((room) => room.starredAt != null);

  return {
    rooms,
    pinnedRooms,
    replaceRoom,
    applyPinnedOrder,
    readAgain,
    answered,
  };
}

/** A room action's answer does not load the Organization the row shows. */
function withWorkspaceOf(current: ChatRoom, updated: ChatRoom): ChatRoom {
  return {
    ...updated,
    organizationName: current.organizationName,
    organizationLogo: current.organizationLogo,
    organizationWebsiteUrl: current.organizationWebsiteUrl,
  };
}
