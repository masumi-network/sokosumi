"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { useSession } from "@/lib/auth/auth.client";

import { getActiveRoomIdFromPathname } from "./active-room-id";
import { fetchSidebarRoomCollection } from "./fetch-sidebar-room-collection";
import {
  subscribeOrganizationChatRoomRead,
  subscribeOrganizationChatRoomsChanged,
} from "./organization-chat-events";
import { roomUnreadReads } from "./room-attention";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
  rememberRoomRead,
} from "./room-read-overlay";
import { useChatRefreshScheduler } from "./use-chat-refresh-scheduler";
import { useChatRoomsReadOwner } from "./use-live-chat-rooms";

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

/**
 * The one copy of the rooms, for the workspace it was read in. The list's rows
 * and the signals mounted outside it (tab title, Chats tab, sidebar toggle) all
 * show it, whichever of them did the reading, and it outlives a reader's
 * unmount so a closing phone sheet does not blink the count.
 */
let held: { scope: string; rooms: ChatRoom[] } | null = null;
/** The room the last reader had open, so the next one knows what was left. */
let heldOpenRoomId: string | null = null;
/**
 * Whoever may read, oldest first. Only the first does, so there is one reader
 * however the surfaces mount. The next takes over when it goes.
 */
let readers: readonly object[] = [];
const heldListeners = new Set<() => void>();

function notifyHeldListeners() {
  for (const listener of heldListeners) listener();
}

function subscribeHeldRooms(listener: () => void) {
  heldListeners.add(listener);
  return () => {
    heldListeners.delete(listener);
  };
}

function getHeldRooms() {
  return held;
}

function getNothingHeld() {
  return null;
}

function getReader() {
  return readers[0] ?? null;
}

/** A read's answer, which is what starts holding a workspace's rooms. */
function setHeldRooms(scope: string, rooms: ChatRoom[]) {
  held = { scope, rooms };
  notifyHeldListeners();
}

function updateHeldRooms(
  scope: string,
  update: (current: ChatRoom[]) => ChatRoom[],
) {
  if (held?.scope === scope) {
    setHeldRooms(scope, update(held.rooms));
  }
}

export function clearElsewhereRooms(): void {
  held = null;
  heldOpenRoomId = null;
  notifyHeldListeners();
}

function useIsElsewhereReader(mayRead: boolean): boolean {
  const [self] = useState(() => ({}));
  const reader = useSyncExternalStore(
    subscribeHeldRooms,
    getReader,
    getNothingHeld,
  );
  useEffect(() => {
    if (!mayRead) {
      return;
    }
    readers = [...readers, self];
    notifyHeldListeners();
    return () => {
      readers = readers.filter((candidate) => candidate !== self);
      notifyHeldListeners();
    };
  }, [mayRead, self]);
  return reader === self;
}

function hasUnread(room: ChatRoom): boolean {
  const { readRoom, lookThreads } = roomUnreadReads(room);
  return readRoom || lookThreads;
}

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
 * The same rooms, for the unread signals mounted outside the chat list. While a
 * list is mounted it reads and this only shows what it holds; without one (the
 * phone, away from the Chats list) this reads itself, by the same rule
 * `useLiveChatRooms` follows for the active collection.
 */
export function useLiveElsewhereRooms(): ChatRoom[] {
  const { data: session } = useSession();
  const pathname = usePathname();
  const { sidebarOwnsReads, ownershipSettled } = useChatRoomsReadOwner();
  const currentUserId = session?.user.id ?? null;
  const { rooms } = useElsewhereRooms({
    currentUserId,
    organizationId: session?.session.activeOrganizationId ?? null,
    activeRoomId: getActiveRoomIdFromPathname(pathname),
    mayRead: currentUserId !== null && ownershipSettled && !sidebarOwnsReads,
  });
  return rooms;
}

interface UseElsewhereRoomsOptions {
  currentUserId: string | null;
  organizationId: string | null;
  activeRoomId: string | null;
  /** Whether this surface may be the reader. It shows the rooms either way. */
  mayRead: boolean;
}

/**
 * The unread rooms of the reader's other workspaces, in Core's order, for the
 * Elsewhere rows (ADR-0061). No timer reads: Core tells each member's control
 * channel about every message, so this reads on that, on mount, when the reader
 * returns to the window, and when a lost connection comes back. The window is
 * how a read in another tab or on another device arrives, because it sends no
 * event; a read in this tab clears locally.
 *
 * A room the reader has read or muted stays held until the next read or until
 * they leave it, but only the open room is answered: that is what takes a read
 * row away once the reader moves on.
 *
 * `answered` turns true once the first read has come back, listed or failed, so
 * a caller can tell "nothing unread" from "not asked yet".
 */
export function useElsewhereRooms({
  currentUserId,
  organizationId,
  activeRoomId,
  mayRead,
}: UseElsewhereRoomsOptions) {
  const scope = `${organizationId ?? ""}:${currentUserId}:elsewhere`;
  const snapshot = useSyncExternalStore(
    subscribeHeldRooms,
    getHeldRooms,
    getNothingHeld,
  );
  // A room of the workspace just left is not "elsewhere" any more, and one of
  // the workspace just entered must not show twice.
  const answered = snapshot?.scope === scope;
  const heldRooms = answered ? snapshot.rooms : NO_ROOMS;
  const isReader = useIsElsewhereReader(mayRead);
  const activeRoomIdRef = useRef(activeRoomId);
  activeRoomIdRef.current = activeRoomId;

  const refresh = useCallback(
    async (isCurrent: () => boolean) => {
      const requestRevision = beginRoomAttentionRefresh();
      const rooms = await fetchSidebarRoomCollection("elsewhere");
      if (!isCurrent()) return;
      const current = held?.scope === scope ? held.rooms : NO_ROOMS;
      setHeldRooms(
        scope,
        rooms
          ? keepOpenRoomRow(
              current,
              reconcileRoomAttention(rooms, requestRevision),
              activeRoomIdRef.current,
            )
          : current,
      );
    },
    [scope],
  );
  const healthy = useAblyConnectionHealthy();
  const requestRead = useChatRefreshScheduler({
    key: isReader ? scope : null,
    refresh,
    healthy,
    refreshOnMount: true,
    refreshOnRecovery: true,
    refreshOnForeground: true,
  });

  useEffect(() => {
    if (!isReader) {
      return;
    }
    let timer: number | undefined;
    let lastReadAt = 0;

    function read() {
      timer = undefined;
      lastReadAt = Date.now();
      requestRead();
    }

    const unsubscribe = subscribeOrganizationChatRoomsChanged({
      onRemoved: (removedRoomId) =>
        updateHeldRooms(scope, (current) =>
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
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [isReader, scope, requestRead]);

  useEffect(() => {
    if (!isReader) {
      return;
    }
    return subscribeOrganizationChatRoomRead(
      (apply) => updateHeldRooms(scope, apply),
      withWorkspaceOf,
    );
  }, [isReader, scope]);

  // A row is held for its room only while the room stays open. Forgotten here,
  // not just hidden, or coming back to the room would answer it again.
  useEffect(() => {
    if (!isReader || heldOpenRoomId === activeRoomId) {
      return;
    }
    const leftRoomId = heldOpenRoomId;
    heldOpenRoomId = activeRoomId;
    if (leftRoomId !== null) {
      updateHeldRooms(scope, (current) =>
        current.filter((room) => room.id !== leftRoomId || hasUnread(room)),
      );
    }
  }, [isReader, scope, activeRoomId]);

  const replaceRoom = useCallback(
    (updated: ChatRoom) => {
      if (updated.markedUnread) {
        rememberRoomRead(updated);
      }
      updateHeldRooms(scope, (current) =>
        applyRoomReadOverlays(
          current.map((room) =>
            room.id === updated.id ? withWorkspaceOf(room, updated) : room,
          ),
        ),
      );
    },
    [scope],
  );

  const rooms = heldRooms.filter(
    (room) => hasUnread(room) || room.id === activeRoomId,
  );

  return { rooms, replaceRoom, answered };
}

/** A room action's answer does not load the Organization's name the row shows. */
function withWorkspaceOf(current: ChatRoom, updated: ChatRoom): ChatRoom {
  return { ...updated, organizationName: current.organizationName };
}
