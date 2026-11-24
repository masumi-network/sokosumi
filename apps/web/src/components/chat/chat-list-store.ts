import type {
  ChatRoom,
  ChatRoomInvitation,
  StarredChatRoomOrder,
} from "@sokosumi/core-client";
import type { ChatRoomCollection } from "@sokosumi/utils";
import type { SetStateAction } from "react";
import { chatReadThrottleResumeInMs } from "@/lib/chat/chat-read-throttle";

import {
  CHAT_HEALTHY_REFRESH_MS,
  createChatRefreshScheduler,
} from "./chat-refresh-scheduler";
import { withPinnedOrder } from "./chat-room-activity-sort";
import {
  fetchSidebarRoom,
  fetchSidebarRoomCollection,
} from "./fetch-sidebar-room-collection";
import { getLatestMembershipVisibleRoomsSnapshot } from "./membership-visible-rooms-store";
import {
  subscribeOrganizationChatRoomRead,
  subscribeOrganizationChatRoomsChanged,
} from "./organization-chat-events";
import { keepRoomUnreadState } from "./room-attention";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  reconcileRoomAttention,
  rememberRoomRead,
} from "./room-read-overlay";

/**
 * Most rooms one active read fetches singly. Past this the whole list is one
 * request and the single reads are several.
 */
const MAX_SINGLE_ROOM_READS = 3;

/** Poll cadence per collection while the Ably connection is unavailable. */
const ORGANIZATION_CHAT_FALLBACK_MS = 15_000;

export interface ActiveChatRoomsStoreOptions {
  initialRooms: ChatRoom[];
  healthy: boolean;
  onChange?: () => void;
}

export interface ActiveChatRoomsStore {
  getRows: () => ChatRoom[];
  replaceFromProps: (rooms: ChatRoom[], overlaidRooms?: ChatRoom[]) => void;
  updateRows: (apply: (current: ChatRoom[]) => ChatRoom[]) => void;
  upsertRoomToTop: (room: ChatRoom) => number;
  removeRoom: (removedRoomId: string) => number;
  replaceRoom: (updated: ChatRoom) => void;
  applyPinnedOrder: (order: StarredChatRoomOrder[]) => void;
  replaceAllRooms: (rooms: ChatRoom[], requestRevision: number) => boolean;
  replaceListedRooms: (fresh: ChatRoom[], requestRevision: number) => boolean;
  resetStaleForScope: () => void;
  markWholeListStale: () => void;
  markRoomOrWholeListStale: (roomId?: string | null) => void;
  start: () => void;
  stop: () => void;
  request: () => void;
  setHealth: (healthy: boolean) => void;
}

/**
 * Owns the active chat rooms collection: its rows, revision counters,
 * single-room vs whole-list staleness, and refresh scheduler.
 */
export function createActiveChatRoomsStore({
  initialRooms,
  healthy: initialHealthy,
  onChange,
}: ActiveChatRoomsStoreOptions): ActiveChatRoomsStore {
  let rows = initialRooms;
  let latestAppliedRefresh = 0;
  let latestRoomSwap = 0;
  /**
   * What the next active read has to fetch. A message event names its room,
   * and a listed room can be read alone (the list is every room the reader
   * holds, up to fifty pages of it). Anything else needs the whole list: a
   * room not listed yet, an event naming none, and the reads that exist to
   * find a lost event: mount, a workspace or user switch, recovery and coming
   * back online. Those ask for the whole list below, because a room named
   * while one of them waits would otherwise turn it into a one-room read.
   *
   * Every read re-arms the recovery timer, so in a busy workspace the timer
   * never fires. The whole list is still read once per recovery interval:
   * that read is what finds a room whose event was lost.
   */
  let staleActive = { rooms: new Set<string>(), wholeList: false };
  let wholeListReadAt = 0;
  let currentHealthy = initialHealthy;

  function setRows(next: ChatRoom[]): void {
    if (next === rows) {
      return;
    }
    rows = next;
    onChange?.();
  }

  function replaceFromProps(
    rooms: ChatRoom[],
    overlaidRooms?: ChatRoom[],
  ): void {
    setRows(overlaidRooms ?? applyRoomReadOverlays(rooms));
  }

  function updateRows(apply: (current: ChatRoom[]) => ChatRoom[]): void {
    setRows(apply(rows));
  }

  /**
   * Put a room at the top of the live list, replacing any row already there.
   * What was unread on that row stays: the answers that land here do not
   * count it.
   */
  function upsertRoomToTop(room: ChatRoom): number {
    const revision = beginRoomAttentionRefresh();
    latestAppliedRefresh = revision;
    const held = rows.find((row) => row.id === room.id);
    const without = rows.filter((row) => row.id !== room.id);
    setRows(
      applyRoomReadOverlays([keepRoomUnreadState(held, room), ...without]),
    );
    return revision;
  }

  function removeRoom(removedRoomId: string): number {
    const revision = beginRoomAttentionRefresh();
    latestAppliedRefresh = revision;
    setRows(
      applyRoomReadOverlays(rows.filter((row) => row.id !== removedRoomId)),
    );
    return revision;
  }

  /**
   * Swap one room in the live list for a newer copy of itself.
   *
   * Mark unread retains the new attention for a later remount with stale
   * props. The action caller owns its pending operation and rollback.
   */
  function replaceRoom(updated: ChatRoom): void {
    if (updated.markedUnread) {
      rememberRoomRead(updated);
    }
    setRows(
      applyRoomReadOverlays(
        rows.map((room) => (room.id === updated.id ? updated : room)),
      ),
    );
  }

  /** Write a pinned order's `starredAt` sort keys onto the live list. */
  function applyPinnedOrder(order: StarredChatRoomOrder[]): void {
    // A list fetch already in flight predates this order; drop it on arrival.
    latestAppliedRefresh = beginRoomAttentionRefresh();
    setRows(withPinnedOrder(rows, order));
  }

  /**
   * Replace the whole live list with a freshly fetched one. False when a
   * newer change to the list overtook the read and it was dropped.
   *
   * Either way the list can now be behind something: a dropped read never
   * landed, and one that started before a one-room read puts that room's
   * older copy back. Both leave the whole list owed.
   */
  function replaceAllRooms(
    nextRooms: ChatRoom[],
    requestRevision: number,
  ): boolean {
    if (requestRevision < latestAppliedRefresh) {
      staleActive.wholeList = true;
      return false;
    }
    if (requestRevision < latestRoomSwap) {
      staleActive.wholeList = true;
    }
    latestAppliedRefresh = requestRevision;
    setRows(reconcileRoomAttention(nextRooms, requestRevision));
    return true;
  }

  /**
   * Swap listed rooms for fresh copies of themselves, by the same attention
   * rule as a whole-list read. A room no longer listed is left out. False
   * when a newer change to the list overtook the read and it was dropped.
   *
   * It leaves the list's own revision where it was. A whole-list read that
   * started earlier (a failed pin reorder reloading, say) still has rows this
   * one did not read, so it must land; `replaceAllRooms` then owes a newer
   * list for the room this one swapped.
   */
  function replaceListedRooms(
    fresh: ChatRoom[],
    requestRevision: number,
  ): boolean {
    if (requestRevision < latestAppliedRefresh) return false;
    latestRoomSwap = requestRevision;
    const freshById = new Map(
      reconcileRoomAttention(fresh, requestRevision).map((room) => [
        room.id,
        room,
      ]),
    );
    setRows(
      rows.map((row) => {
        const room = freshById.get(row.id);
        // Core loads the workspace logo and website for the list only.
        return room
          ? {
              ...room,
              organizationLogo: row.organizationLogo,
              organizationWebsiteUrl: row.organizationWebsiteUrl,
            }
          : row;
      }),
    );
    return true;
  }

  /** Each collection recovers on its own; a failed read keeps the last rows. */
  async function refreshActive(isCurrent: () => boolean): Promise<void> {
    const stale = staleActive;
    const roomIds = stale.wholeList ? [] : [...stale.rooms];
    staleActive = { rooms: new Set(), wholeList: false };
    let requestRevision = beginRoomAttentionRefresh();
    if (
      roomIds.length > 0 &&
      roomIds.length <= MAX_SINGLE_ROOM_READS &&
      Date.now() - wholeListReadAt < CHAT_HEALTHY_REFRESH_MS
    ) {
      const fresh = await Promise.all(roomIds.map(fetchSidebarRoom));
      if (!isCurrent()) return;
      const answered = fresh.filter((room) => room !== null);
      if (answered.length < fresh.length) {
        // A read that failed says nothing about the room, and the list
        // would fail the same way. It stays owed, as a failed list read
        // does. A throttle is the one failure with an end, so that waits
        // out the window like any other read.
        staleActive.wholeList = true;
        if (chatReadThrottleResumeInMs() > 0) scheduler.request();
        return;
      }
      const nextRooms = answered.filter((room) => room !== "gone");
      if (nextRooms.length === answered.length) {
        // A dropped answer leaves its room stale with nothing to say so.
        // The next read of any kind then takes the whole list.
        // So does an answer for a room that left the rows meanwhile.
        const listed = nextRooms.every((room) =>
          rows.some((row) => row.id === room.id),
        );
        if (!replaceListedRooms(nextRooms, requestRevision) || !listed) {
          staleActive.wholeList = true;
        }
        return;
      }
      // A room the reader can no longer open has left the list. The list
      // read starts now, so a change made during the room reads predates it.
      requestRevision = beginRoomAttentionRefresh();
    }
    const nextWholeListReadAt = Date.now();
    const page = await fetchSidebarRoomCollection("active");
    if (!isCurrent()) return;
    if (!page) {
      // Whatever asked for the whole list is still owed it.
      staleActive.wholeList = true;
      return;
    }
    wholeListReadAt = nextWholeListReadAt;
    replaceAllRooms(page.rooms, requestRevision);
  }

  const scheduler = createChatRefreshScheduler({
    refresh: refreshActive,
    healthy: initialHealthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });

  function resetStaleForScope(): void {
    staleActive = { rooms: new Set(), wholeList: true };
  }

  function markWholeListStale(): void {
    staleActive.wholeList = true;
  }

  function markRoomOrWholeListStale(roomId?: string | null): void {
    if (roomId && rows.some((row) => row.id === roomId)) {
      staleActive.rooms.add(roomId);
    } else {
      staleActive.wholeList = true;
    }
  }

  function setHealth(healthy: boolean): void {
    if (healthy === currentHealthy) {
      return;
    }
    currentHealthy = healthy;
    scheduler.setHealth(healthy);
  }

  return {
    getRows: () => rows,
    replaceFromProps,
    updateRows,
    upsertRoomToTop,
    removeRoom,
    replaceRoom,
    applyPinnedOrder,
    replaceAllRooms,
    replaceListedRooms,
    resetStaleForScope,
    markWholeListStale,
    markRoomOrWholeListStale,
    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
    request: () => scheduler.request(),
    setHealth,
  };
}

export interface ChatListStoreOptions {
  rooms: ChatRoom[];
  archivedRooms: ChatRoom[];
  pendingInvitations: ChatRoomInvitation[];
  currentUserId: string;
  organizationId: string | null;
  paintOnly: boolean;
  healthy: boolean;
}

export interface ChatListStoreScope {
  organizationId: string | null;
  currentUserId: string;
}

export interface ChatListStorePropsSync {
  rooms: ChatRoom[];
  /** Pre-overlaid rows derived during render so the store keeps the same array identity. */
  overlaidRooms?: ChatRoom[];
  archivedRooms: ChatRoom[];
  pendingInvitations: ChatRoomInvitation[];
}

export interface ChatListStoreSnapshot {
  roomRows: ChatRoom[];
  archivedRows: ChatRoom[];
  pendingRows: ChatRoomInvitation[];
  sourceRooms: ChatRoom[];
  sourceArchivedRooms: ChatRoom[];
  sourcePendingInvitations: ChatRoomInvitation[];
}

export interface ChatListStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ChatListStoreSnapshot;
  attach: (scope: ChatListStoreScope, healthy?: boolean) => void;
  detach: () => void;
  setHealth: (healthy: boolean) => void;
  syncProps: (props: ChatListStorePropsSync) => void;
  setArchivedRows: (next: SetStateAction<ChatRoom[]>) => void;
  setPendingRows: (next: SetStateAction<ChatRoomInvitation[]>) => void;
  upsertRoomToTop: (room: ChatRoom) => void;
  replaceRoom: (updated: ChatRoom) => void;
  replaceAllRooms: (rooms: ChatRoom[], requestRevision: number) => boolean;
  applyPinnedOrder: (order: StarredChatRoomOrder[]) => void;
}

function resolveInitialActiveRooms({
  rooms,
  organizationId,
  currentUserId,
  paintOnly,
}: Pick<
  ChatListStoreOptions,
  "rooms" | "organizationId" | "currentUserId" | "paintOnly"
>): ChatRoom[] {
  const snapshot = getLatestMembershipVisibleRoomsSnapshot();
  // Closing the mobile Sheet unmounts this list. Its unchanged RSC seed must
  // not replace a roster already fetched in this session while Core refreshes.
  const remountRooms =
    !paintOnly &&
    snapshot?.organizationId === organizationId &&
    snapshot.currentUserId === currentUserId &&
    snapshot.sourceRooms === rooms
      ? [...snapshot.rooms]
      : rooms;
  return applyRoomReadOverlays(remountRooms);
}

/**
 * Per-mount store for the chat sidebar's three collections (active, archived,
 * invitations), their revisions, their schedulers, and their window listeners.
 */
export function createChatListStore({
  rooms,
  archivedRooms: initialArchivedRooms,
  pendingInvitations: initialPendingInvitations,
  currentUserId,
  organizationId,
  paintOnly,
  healthy: initialHealthy,
}: ChatListStoreOptions): ChatListStore {
  const listeners = new Set<() => void>();
  let batchDepth = 0;
  let dirty = false;

  let archivedRows = initialArchivedRooms;
  let pendingRows = initialPendingInvitations;
  let prevRooms = rooms;
  let prevArchivedRooms = initialArchivedRooms;
  let prevPendingInvitations = initialPendingInvitations;
  let latestArchivedRefresh = 0;
  let latestInvitationsRefresh = 0;
  let currentHealthy = initialHealthy;
  let detachCurrent: (() => void) | null = null;

  const active = createActiveChatRoomsStore({
    initialRooms: resolveInitialActiveRooms({
      rooms,
      organizationId,
      currentUserId,
      paintOnly,
    }),
    healthy: initialHealthy,
    onChange: () => emit(),
  });

  let snapshot: ChatListStoreSnapshot = {
    roomRows: active.getRows(),
    archivedRows,
    pendingRows,
    sourceRooms: prevRooms,
    sourceArchivedRooms: prevArchivedRooms,
    sourcePendingInvitations: prevPendingInvitations,
  };

  function emit(): void {
    if (batchDepth > 0) {
      dirty = true;
      return;
    }
    snapshot = {
      roomRows: active.getRows(),
      archivedRows,
      pendingRows,
      sourceRooms: prevRooms,
      sourceArchivedRooms: prevArchivedRooms,
      sourcePendingInvitations: prevPendingInvitations,
    };
    for (const listener of listeners) {
      listener();
    }
  }

  function batch(run: () => void): void {
    batchDepth += 1;
    try {
      run();
    } finally {
      batchDepth -= 1;
      if (batchDepth === 0 && dirty) {
        dirty = false;
        emit();
      }
    }
  }

  function setArchivedRows(next: SetStateAction<ChatRoom[]>): void {
    const resolved = typeof next === "function" ? next(archivedRows) : next;
    if (resolved === archivedRows) {
      return;
    }
    archivedRows = resolved;
    emit();
  }

  function setPendingRows(next: SetStateAction<ChatRoomInvitation[]>): void {
    const resolved = typeof next === "function" ? next(pendingRows) : next;
    if (resolved === pendingRows) {
      return;
    }
    pendingRows = resolved;
    emit();
  }

  function upsertRoomToTop(room: ChatRoom): void {
    batch(() => {
      // The archived copy goes at the same time: a room is live or archived,
      // never both, so the two collections cannot be updated apart without
      // the room appearing twice.
      latestArchivedRefresh = active.upsertRoomToTop(room);
      if (archivedRows.some((row) => row.id === room.id)) {
        setArchivedRows((current) =>
          current.filter((row) => row.id !== room.id),
        );
      }
    });
  }

  function removeRoom(removedRoomId: string): void {
    batch(() => {
      latestArchivedRefresh = active.removeRoom(removedRoomId);
      if (archivedRows.some((row) => row.id === removedRoomId)) {
        setArchivedRows((current) =>
          current.filter((row) => row.id !== removedRoomId),
        );
      }
    });
  }

  async function refreshArchived(isCurrent: () => boolean): Promise<void> {
    const requestRevision = beginRoomAttentionRefresh();
    const page = await fetchSidebarRoomCollection("archived");
    if (!isCurrent() || !page || requestRevision < latestArchivedRefresh) {
      return;
    }
    latestArchivedRefresh = requestRevision;
    setArchivedRows(page.rooms);
  }

  async function refreshInvitations(isCurrent: () => boolean): Promise<void> {
    const requestRevision = beginRoomAttentionRefresh();
    const invitations = await fetchSidebarRoomCollection("invitations");
    if (
      !isCurrent() ||
      !invitations ||
      requestRevision < latestInvitationsRefresh
    ) {
      return;
    }
    latestInvitationsRefresh = requestRevision;
    setPendingRows(invitations);
  }

  // Archived rooms carry no unread state and arrive with the page, so they
  // skip the mount read; archive and restore events still ask for them.
  const archivedScheduler = createChatRefreshScheduler({
    refresh: refreshArchived,
    healthy: initialHealthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnRecovery: true,
  });

  const invitationsScheduler = createChatRefreshScheduler({
    refresh: refreshInvitations,
    healthy: initialHealthy,
    fallbackIntervalMs: ORGANIZATION_CHAT_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });

  function requestCollections(
    collections?: readonly ChatRoomCollection[],
    roomId?: string | null,
  ): void {
    const wanted = new Set<ChatRoomCollection>(
      collections ?? ["active", "archived", "invitations"],
    );
    if (wanted.has("active")) {
      active.markRoomOrWholeListStale(roomId);
      active.request();
    }
    if (wanted.has("archived")) archivedScheduler.request();
    if (wanted.has("invitations")) invitationsScheduler.request();
  }

  function detach(): void {
    const cleanup = detachCurrent;
    detachCurrent = null;
    cleanup?.();
  }

  function attach(scope: ChatListStoreScope, nextHealthy?: boolean): void {
    detach();

    let attached = true;
    let unsubRoomRead: (() => void) | null = null;
    let unsubRoomsChanged: (() => void) | null = null;

    active.resetStaleForScope();
    const onOnline = () => {
      active.markWholeListStale();
    };
    window.addEventListener("online", onOnline);

    // Install cleanup before starting schedulers so a synchronous detach()
    // inside a mount refresh stops cleanly and aborts remaining setup.
    detachCurrent = () => {
      attached = false;
      window.removeEventListener("online", onOnline);
      active.stop();
      archivedScheduler.stop();
      invitationsScheduler.stop();
      unsubRoomRead?.();
      unsubRoomRead = null;
      unsubRoomsChanged?.();
      unsubRoomsChanged = null;
    };

    const syncHealth =
      nextHealthy !== undefined && nextHealthy !== currentHealthy;

    // Match main's per-collection start-then-health order so a simultaneous
    // scope change and health recovery batches active, archived, invitations.
    active.start();
    if (!attached) return;
    if (syncHealth) {
      active.setHealth(nextHealthy);
    }
    if (!attached) return;

    if (Boolean(scope.organizationId)) {
      archivedScheduler.start();
    }
    if (!attached) return;
    if (syncHealth) {
      archivedScheduler.setHealth(nextHealthy);
    }
    if (!attached) return;

    invitationsScheduler.start();
    if (!attached) return;
    if (syncHealth) {
      invitationsScheduler.setHealth(nextHealthy);
    }
    if (!attached) return;

    if (syncHealth) {
      currentHealthy = nextHealthy;
    }

    unsubRoomRead = subscribeOrganizationChatRoomRead((apply) => {
      active.updateRows(apply);
    });
    unsubRoomsChanged = subscribeOrganizationChatRoomsChanged({
      onRemoved: removeRoom,
      onRoom: upsertRoomToTop,
      onInvalidated: requestCollections,
    });
  }

  function setHealth(healthy: boolean): void {
    if (healthy === currentHealthy) {
      return;
    }
    currentHealthy = healthy;
    // Mark wholeList before the schedulers hear about health so a recovery
    // read fetches the whole list in case an event was missed.
    active.markWholeListStale();
    active.setHealth(healthy);
    archivedScheduler.setHealth(healthy);
    invitationsScheduler.setHealth(healthy);
  }

  function syncProps({
    rooms: nextRooms,
    overlaidRooms,
    archivedRooms: nextArchivedRooms,
    pendingInvitations: nextPendingInvitations,
  }: ChatListStorePropsSync): void {
    batch(() => {
      let sourceChanged = false;
      // Replace local list when RSC props change (full membership-visible set).
      if (nextRooms !== prevRooms) {
        prevRooms = nextRooms;
        sourceChanged = true;
        active.replaceFromProps(nextRooms, overlaidRooms);
      }
      if (nextArchivedRooms !== prevArchivedRooms) {
        prevArchivedRooms = nextArchivedRooms;
        sourceChanged = true;
        setArchivedRows(nextArchivedRooms);
      }
      if (nextPendingInvitations !== prevPendingInvitations) {
        prevPendingInvitations = nextPendingInvitations;
        sourceChanged = true;
        setPendingRows(nextPendingInvitations);
      }
      if (sourceChanged) {
        emit();
      }
    });
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    subscribe,
    getSnapshot: () => snapshot,
    attach,
    detach,
    setHealth,
    syncProps,
    setArchivedRows,
    setPendingRows,
    upsertRoomToTop,
    replaceRoom: active.replaceRoom,
    replaceAllRooms: active.replaceAllRooms,
    applyPinnedOrder: active.applyPinnedOrder,
  };
}
