import type { ChatRoom } from "@sokosumi/core-client";

import {
  type ChatRefreshScheduler,
  createChatRefreshScheduler,
} from "./chat-refresh-scheduler";
import { fetchSidebarRoomCollection } from "./fetch-sidebar-room-collection";
import {
  subscribeOrganizationChatRoomRead,
  subscribeOrganizationChatRoomsChanged,
} from "./organization-chat-events";
import { keepRoomUnreadState } from "./room-attention";
import {
  applyRoomReadOverlays,
  beginRoomAttentionRefresh,
  getRoomReadOverlayVersion,
  reconcileRoomAttention,
} from "./room-read-overlay";

/**
 * Session snapshot of membership-visible rooms from the chat sidebar list.
 * The open-room page only passes the selected room into RoomsClient (LCP);
 * Channel links still need the full set. Survives mobile Sheet unmount
 * for the same workspace; ignored when organizationId does not match.
 *
 * Instant `/chat` loading and the Chats tab unread dot also read the latest
 * snapshot (any org) so soft-nav back can first-paint real rows + overlay
 * instead of bone rows / an empty unread dot (SOK-903). Workspace activation
 * clears the snapshot so Instant never paints the previous org after a switch.
 */
const EMPTY_ROOMS: readonly ChatRoom[] = [];

/** Poll cadence while the Ably connection is unavailable. */
const LIVE_CHAT_ROOMS_FALLBACK_MS = 15_000;

/** How long a desktop page waits for its sidebar to take over the reads. */
export const SIDEBAR_REGISTRATION_WAIT_MS = 2_000;

/** Matches Tailwind `md` (`MOBILE_BREAKPOINT` in `@/hooks/effects/use-mobile`). */
const MOBILE_BREAKPOINT_PX = 768;

export interface MembershipVisibleRoomsSnapshot {
  organizationId: string | null;
  rooms: readonly ChatRoom[];
  currentUserId: string;
  /** RSC collection that seeded the publisher; identifies stale Sheet remounts. */
  sourceRooms?: readonly ChatRoom[];
}

export interface LiveChatRoomsReadSnapshot {
  rooms: ChatRoom[] | null;
  failed: boolean;
}

export interface AttachLiveChatRoomsReaderOptions {
  organizationId: string | null;
  currentUserId: string;
  healthy?: boolean;
  /** True when re-attaching a hidden React Activity subtree; preserves held rows and failure state. */
  isReveal?: boolean;
}

export interface LiveChatRoomsReaderHandle {
  /**
   * Advances committed scope and live health in the layout phase so an
   * in-flight read landing before passive cleanup is dropped (matching main's
   * `scopeRef`) and `scheduler.start()` reads current health (matching main's
   * `healthyRef`).
   */
  commitRenderState: (
    organizationId: string | null,
    currentUserId: string,
    healthy: boolean,
  ) => void;
  setScope: (organizationId: string | null, currentUserId: string) => void;
  setHealth: (healthy: boolean) => void;
  detach: () => void;
}

/** Rows with the scope they were read in, so another scope's never show. */
interface HeldRooms {
  scope: string | null;
  rooms: ChatRoom[] | null;
}

interface AttachedReaderEntry {
  organizationId: string | null;
  currentUserId: string;
  scope: string | null;
  committedScope: string | null;
  detached: boolean;
}

interface SchedulerDemandEntry {
  key: string;
  released: boolean;
}

const EMPTY_LIVE_READ: LiveChatRoomsReadSnapshot = {
  rooms: null,
  failed: false,
};

let snapshotOrganizationKey: string | null = null;
let snapshot: readonly ChatRoom[] = EMPTY_ROOMS;
let snapshotCurrentUserId = "";
let snapshotSourceRooms: readonly ChatRoom[] | undefined;
let latestSnapshot: MembershipVisibleRoomsSnapshot | null = null;
let livePublisherCount = 0;
const listeners = new Set<() => void>();

// Module-level live-rooms reader shared by every surface without a mounted
// sidebar list (Chats tab dot, Go-to search, Threads, Decisions, Saved).
let held: HeldRooms = { scope: null, rooms: null };
let latestAppliedRefresh = 0;
let failedScope: string | null = null;
let trackedScope: string | null = null;
let syncedSnapshot: MembershipVisibleRoomsSnapshot | null = null;
let activeOrganizationId: string | null = null;
let activeCurrentUserId = "";
let activeScope: string | null = null;
let committedScope: string | null = null;
let liveHealthy = false;
let syncedHealthy = false;
let ownershipSettled = false;
let ownershipWaitTimer: number | undefined;
let scheduler: ChatRefreshScheduler | null = null;
let activeSchedulerKey: string | null = null;
let unsubscribeRoomRead: (() => void) | null = null;
let unsubscribeRoomsChanged: (() => void) | null = null;
let windowListenersCount = 0;
const attachedReaders = new Set<AttachedReaderEntry>();
const schedulerDemands = new Set<SchedulerDemandEntry>();
const liveRoomsListeners = new Set<() => void>();
const ownershipSettledListeners = new Set<() => void>();
const cachedReadByScope = new Map<string, LiveChatRoomsReadSnapshot>();

// Identity-keyed preview cache for `applyRoomReadOverlays([...latestSnapshot.rooms])`
// during pre-attach or pre-commit renders; invalidated by any new snapshot object
// or any room-read-overlay write/delete/clear/expiry.
let cachedPreviewSnapshot: MembershipVisibleRoomsSnapshot | null = null;
let cachedPreviewOverlayVersion = -1;
let cachedPreviewRooms: ChatRoom[] | null = null;

function organizationKey(organizationId: string | null): string {
  return organizationId ?? "";
}

/** The user and workspace a list of rooms belongs to. */
export function liveChatRoomsScope(
  organizationId: string | null,
  userId: string,
): string | null {
  return userId ? `${organizationId ?? ""}:${userId}` : null;
}

function getOverlaidSnapshotRooms(
  source: MembershipVisibleRoomsSnapshot,
): ChatRoom[] {
  const overlayVersion = getRoomReadOverlayVersion();
  if (
    cachedPreviewSnapshot === source &&
    cachedPreviewOverlayVersion === overlayVersion &&
    cachedPreviewRooms !== null
  ) {
    return cachedPreviewRooms;
  }
  const rooms = applyRoomReadOverlays([...source.rooms]);
  cachedPreviewSnapshot = source;
  cachedPreviewOverlayVersion = getRoomReadOverlayVersion();
  cachedPreviewRooms = rooms;
  return rooms;
}

function clearPreviewCache(): void {
  cachedPreviewSnapshot = null;
  cachedPreviewOverlayVersion = -1;
  cachedPreviewRooms = null;
}

function getInitialRoomsFromSessionSnapshot(): HeldRooms {
  const sessionSnapshot = getLatestMembershipVisibleRoomsSnapshot();
  if (sessionSnapshot == null) {
    return { scope: null, rooms: null };
  }
  return {
    scope: liveChatRoomsScope(
      sessionSnapshot.organizationId,
      sessionSnapshot.currentUserId,
    ),
    rooms: getOverlaidSnapshotRooms(sessionSnapshot),
  };
}

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

function notifyLiveRoomsListeners(): void {
  for (const listener of liveRoomsListeners) {
    listener();
  }
}

function notifyOwnershipSettledListeners(): void {
  for (const listener of ownershipSettledListeners) {
    listener();
  }
}

function rebuildLatestSnapshot(): void {
  if (snapshotOrganizationKey === null) {
    latestSnapshot = null;
    return;
  }

  latestSnapshot = {
    organizationId:
      snapshotOrganizationKey === "" ? null : snapshotOrganizationKey,
    rooms: snapshot,
    currentUserId: snapshotCurrentUserId,
    ...(snapshotSourceRooms === undefined
      ? {}
      : { sourceRooms: snapshotSourceRooms }),
  };
}

function ensureScheduler(initialHealthy: boolean): ChatRefreshScheduler {
  scheduler ??= createChatRefreshScheduler({
    refresh: refreshRooms,
    healthy: initialHealthy,
    getHealthy: () => liveHealthy,
    fallbackIntervalMs: LIVE_CHAT_ROOMS_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });
  return scheduler;
}

// Updates a held list in place; a list not read yet stays unread.
function updateHeldRooms(apply: (rooms: ChatRoom[]) => ChatRoom[]): void {
  if (held.rooms === null) {
    return;
  }
  const nextRooms = apply(held.rooms);
  if (nextRooms === held.rooms) {
    return;
  }
  held = { ...held, rooms: nextRooms };
  notifyLiveRoomsListeners();
}

// A mounted sidebar list already reads the active collection on the same
// schedule; mirror its rows rather than run a second reader (desktop).
// The mirrored rows stay after the list unmounts until the own read lands.
function syncMirroredSnapshot(): boolean {
  const mirroredSnapshot =
    livePublisherCount > 0 &&
    latestSnapshot &&
    latestSnapshot.currentUserId === activeCurrentUserId &&
    latestSnapshot.organizationId === activeOrganizationId
      ? latestSnapshot
      : null;

  if (mirroredSnapshot && mirroredSnapshot !== syncedSnapshot) {
    syncedSnapshot = mirroredSnapshot;
    held = {
      scope: activeScope,
      rooms: getOverlaidSnapshotRooms(mirroredSnapshot),
    };
    return true;
  }
  if (!mirroredSnapshot && syncedSnapshot !== null) {
    syncedSnapshot = null;
  }
  return false;
}

// Drop the previous workspace's rows before the new GET lands so an
// in-flight response cannot light the dot for the wrong org (SOK-986).
// Runs after the mirror so a matching snapshot's local read overlays win.
function syncScopeChangeReset(): boolean {
  if (trackedScope === activeScope) {
    return false;
  }
  const previous = trackedScope;
  trackedScope = activeScope;
  if (activeScope && previous !== null) {
    latestAppliedRefresh = 0;
    const currentSnapshot = getLatestMembershipVisibleRoomsSnapshot();
    held = {
      scope: activeScope,
      rooms:
        currentSnapshot &&
        currentSnapshot.currentUserId === activeCurrentUserId &&
        currentSnapshot.organizationId === activeOrganizationId
          ? getOverlaidSnapshotRooms(currentSnapshot)
          : null,
    };
    return true;
  }
  return false;
}

// Same GET read and scheduling rules as the sidebar's active collection
// (SOK-986): timer reads pause while hidden or unfocused with one read on
// return, invalidations read at once, and a slow recovery cadence while
// Ably is connected.
async function refreshRooms(isCurrent: () => boolean): Promise<void> {
  const requestRevision = beginRoomAttentionRefresh();
  // `committedScope` moves in the layout phase, before the scheduler's passive
  // cleanup makes `isCurrent` false, so an answer can land between them.
  const requestScope = committedScope;
  const page = await fetchSidebarRoomCollection("active");
  if (!isCurrent() || committedScope !== requestScope) return;
  if (!page) {
    failedScope = requestScope;
    notifyLiveRoomsListeners();
    return;
  }
  if (requestRevision < latestAppliedRefresh) return;
  failedScope = null;
  latestAppliedRefresh = requestRevision;
  held = {
    scope: requestScope,
    rooms: reconcileRoomAttention(page.rooms, requestRevision),
  };
  notifyLiveRoomsListeners();
}

function reconcileSchedulerFromDemands(): void {
  let nextKey: string | null = null;
  if (attachedReaders.size > 0) {
    for (const demand of schedulerDemands) {
      nextKey = demand.key;
    }
  }
  if (nextKey === activeSchedulerKey) {
    return;
  }
  activeSchedulerKey = nextKey;
  if (nextKey === null) {
    scheduler?.stop();
    return;
  }
  ensureScheduler(liveHealthy).start({
    fallbackIntervalMs: LIVE_CHAT_ROOMS_FALLBACK_MS,
    refreshOnMount: true,
  });
}

function reconcileCommittedScopeFromReaders(): void {
  let nextCommittedScope: string | null = null;
  for (const reader of attachedReaders) {
    if (reader.committedScope !== null) {
      nextCommittedScope = reader.committedScope;
    }
  }
  committedScope = nextCommittedScope;
}

function reconcileActiveScopeFromReaders(): boolean {
  let nextOrg: string | null = null;
  let nextUser = "";
  let nextScope: string | null = null;
  for (const reader of attachedReaders) {
    if (reader.scope !== null) {
      nextOrg = reader.organizationId;
      nextUser = reader.currentUserId;
      nextScope = reader.scope;
    }
  }
  reconcileCommittedScopeFromReaders();
  if (
    nextScope === activeScope &&
    nextOrg === activeOrganizationId &&
    nextUser === activeCurrentUserId
  ) {
    return false;
  }
  activeOrganizationId = nextOrg;
  activeCurrentUserId = nextUser;
  activeScope = nextScope;
  const didMirror = syncMirroredSnapshot();
  const didReset = syncScopeChangeReset();
  if (didMirror || didReset) {
    notifyLiveRoomsListeners();
  }
  return true;
}

function clearOwnershipWaitTimer(): void {
  if (ownershipWaitTimer !== undefined && typeof window !== "undefined") {
    window.clearTimeout(ownershipWaitTimer);
  }
  ownershipWaitTimer = undefined;
}

function startOwnershipSettle(): void {
  if (ownershipSettled || typeof window === "undefined") {
    return;
  }
  clearOwnershipWaitTimer();
  // The desktop sidebar registers as the reader from an effect, often in a
  // later streamed commit than this hook's. Reading at once would read the
  // same collection twice, so on desktop this waits a moment for it; on a
  // phone there is no sidebar to wait for.
  if (window.innerWidth < MOBILE_BREAKPOINT_PX) {
    ownershipSettled = true;
    notifyOwnershipSettledListeners();
    return;
  }
  ownershipWaitTimer = window.setTimeout(() => {
    ownershipWaitTimer = undefined;
    ownershipSettled = true;
    notifyOwnershipSettledListeners();
  }, SIDEBAR_REGISTRATION_WAIT_MS);
}

function resetDetachedReaderState(): void {
  clearOwnershipWaitTimer();
  ownershipSettled = false;
  schedulerDemands.clear();
  activeSchedulerKey = null;
  const activeScheduler = scheduler;
  scheduler = null;
  activeScheduler?.stop();
  held = { scope: null, rooms: null };
  latestAppliedRefresh = 0;
  failedScope = null;
  trackedScope = null;
  syncedSnapshot = null;
  activeOrganizationId = null;
  activeCurrentUserId = "";
  activeScope = null;
  committedScope = null;
  liveHealthy = false;
  syncedHealthy = false;
  cachedReadByScope.clear();
  clearPreviewCache();
}

/**
 * Attaches a live-rooms reader to the shared module-level owner.
 *
 * Manages the shared desktop wait timer and scope/health state. Does not start
 * the scheduler synchronously; callers start the scheduler from observed
 * ownership after commit via `acquireLiveChatRoomsScheduler`, and subscribe
 * room event listeners after it via `acquireLiveChatRoomsWindowListeners`.
 *
 * When the last reader detaches (Activity hide or unmount), only the wait
 * timer stops so `held` rows and `failedScope` survive React Activity hide
 * and reveal; a fresh non-reveal first attach resets them cleanly.
 */
export function attachLiveChatRoomsReader({
  organizationId,
  currentUserId,
  healthy = false,
  isReveal = false,
}: AttachLiveChatRoomsReaderOptions): LiveChatRoomsReaderHandle {
  const scope = liveChatRoomsScope(organizationId, currentUserId);
  const entry: AttachedReaderEntry = {
    organizationId,
    currentUserId,
    scope,
    committedScope: scope,
    detached: false,
  };
  const isFirstReader = attachedReaders.size === 0;
  attachedReaders.add(entry);

  const handle: LiveChatRoomsReaderHandle = {
    commitRenderState(nextOrganizationId, nextCurrentUserId, nextHealthy) {
      if (entry.detached) return;
      liveHealthy = nextHealthy;
      const nextScope = liveChatRoomsScope(
        nextOrganizationId,
        nextCurrentUserId,
      );
      if (entry.committedScope === nextScope) {
        return;
      }
      entry.committedScope = nextScope;
      attachedReaders.delete(entry);
      attachedReaders.add(entry);
      reconcileCommittedScopeFromReaders();
    },
    setScope(nextOrganizationId, nextCurrentUserId) {
      if (entry.detached) return;
      const nextScope = liveChatRoomsScope(
        nextOrganizationId,
        nextCurrentUserId,
      );
      entry.committedScope = nextScope;
      if (
        entry.organizationId === nextOrganizationId &&
        entry.currentUserId === nextCurrentUserId &&
        entry.scope === nextScope
      ) {
        reconcileCommittedScopeFromReaders();
        return;
      }
      entry.organizationId = nextOrganizationId;
      entry.currentUserId = nextCurrentUserId;
      entry.scope = nextScope;
      attachedReaders.delete(entry);
      attachedReaders.add(entry);
      reconcileActiveScopeFromReaders();
    },
    setHealth(nextHealthy) {
      if (entry.detached) return;
      liveHealthy = nextHealthy;
      if (nextHealthy === syncedHealthy) return;
      syncedHealthy = nextHealthy;
      scheduler?.setHealth(nextHealthy, true);
    },
    detach() {
      if (entry.detached) return;
      entry.detached = true;
      attachedReaders.delete(entry);
      if (attachedReaders.size === 0) {
        clearOwnershipWaitTimer();
        reconcileSchedulerFromDemands();
        return;
      }
      reconcileActiveScopeFromReaders();
    },
  };

  if (isFirstReader) {
    if (!isReveal) {
      resetDetachedReaderState();
      held = getInitialRoomsFromSessionSnapshot();
      trackedScope = scope;
      activeOrganizationId = organizationId;
      activeCurrentUserId = currentUserId;
      activeScope = scope;
      committedScope = scope;
      liveHealthy = healthy;
      syncedHealthy = healthy;
      ensureScheduler(healthy);
      const didMirror = syncMirroredSnapshot();
      startOwnershipSettle();
      if (didMirror) {
        notifyLiveRoomsListeners();
      }
    } else {
      liveHealthy = healthy;
      ensureScheduler(healthy);
      const didScopeChange = reconcileActiveScopeFromReaders();
      const didMirror = !didScopeChange && syncMirroredSnapshot();
      startOwnershipSettle();
      if (didMirror) {
        notifyLiveRoomsListeners();
      }
    }
  } else {
    // Keep main's order: update live health and reconcile scope BEFORE any
    // passive health recovery transition runs.
    liveHealthy = healthy;
    if (scope !== null && scope !== activeScope) {
      reconcileActiveScopeFromReaders();
    }
  }

  return handle;
}

/**
 * Acquires shared demand for the live-rooms refresh scheduler under `key`.
 * Starts the scheduler on first demand or key change, and stops it when the
 * last demand releases.
 */
export function acquireLiveChatRoomsScheduler(key: string): () => void {
  const demand: SchedulerDemandEntry = { key, released: false };
  schedulerDemands.add(demand);
  reconcileSchedulerFromDemands();
  return () => {
    if (demand.released) return;
    demand.released = true;
    schedulerDemands.delete(demand);
    reconcileSchedulerFromDemands();
  };
}

/**
 * Acquires shared demand for the `organization-chat-room-read` and
 * `organization-chat-rooms-changed` window listeners. Subscribes on first
 * demand and removes both listeners when the last demand releases.
 */
export function acquireLiveChatRoomsWindowListeners(): () => void {
  windowListenersCount += 1;
  if (windowListenersCount === 1 && typeof window !== "undefined") {
    unsubscribeRoomRead = subscribeOrganizationChatRoomRead((apply) =>
      updateHeldRooms(apply),
    );
    unsubscribeRoomsChanged = subscribeOrganizationChatRoomsChanged({
      onRemoved: (removedRoomId) =>
        updateHeldRooms((current) =>
          applyRoomReadOverlays(
            current.filter((row) => row.id !== removedRoomId),
          ),
        ),
      onRoom: (room) =>
        // The answers that land here do not count what is unread, so the
        // room keeps what the title already counted for it.
        // One room is not the list; the first read still decides it.
        updateHeldRooms((current) => {
          const existing = current.find((row) => row.id === room.id);
          const without = current.filter((row) => row.id !== room.id);
          return applyRoomReadOverlays([
            keepRoomUnreadState(existing, room),
            ...without,
          ]);
        }),
      onInvalidated: (collections) => {
        // Only the active collection holds what is unread.
        if (!collections || collections.includes("active")) {
          scheduler?.request();
        }
      },
    });
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    windowListenersCount -= 1;
    if (windowListenersCount === 0) {
      const stopRoomRead = unsubscribeRoomRead;
      unsubscribeRoomRead = null;
      stopRoomRead?.();

      const stopRoomsChanged = unsubscribeRoomsChanged;
      unsubscribeRoomsChanged = null;
      stopRoomsChanged?.();
    }
  };
}

export function subscribeLiveChatRoomsOwnershipSettled(
  onStoreChange: () => void,
): () => void {
  ownershipSettledListeners.add(onStoreChange);
  return () => {
    ownershipSettledListeners.delete(onStoreChange);
  };
}

export function getLiveChatRoomsOwnershipSettledSnapshot(
  preserveSettled = false,
): boolean {
  if (attachedReaders.size === 0 && !preserveSettled) {
    return false;
  }
  return ownershipSettled;
}

export function subscribeLiveChatRoomsReader(
  onStoreChange: () => void,
): () => void {
  liveRoomsListeners.add(onStoreChange);
  return () => {
    liveRoomsListeners.delete(onStoreChange);
  };
}

export function getLiveChatRoomsReadSnapshot(
  organizationId: string | null,
  currentUserId: string,
  preserveHeld = false,
): LiveChatRoomsReadSnapshot {
  const scope = liveChatRoomsScope(organizationId, currentUserId);
  if (scope === null) {
    return EMPTY_LIVE_READ;
  }

  let rooms: ChatRoom[] | null;
  if (attachedReaders.size === 0 && !preserveHeld) {
    rooms =
      latestSnapshot &&
      latestSnapshot.currentUserId === currentUserId &&
      latestSnapshot.organizationId === organizationId
        ? getOverlaidSnapshotRooms(latestSnapshot)
        : null;
  } else if (trackedScope === scope) {
    if (
      attachedReaders.size === 0 &&
      livePublisherCount > 0 &&
      latestSnapshot &&
      latestSnapshot !== syncedSnapshot &&
      latestSnapshot.currentUserId === currentUserId &&
      latestSnapshot.organizationId === organizationId
    ) {
      rooms = getOverlaidSnapshotRooms(latestSnapshot);
    } else {
      // Rows read for another user or workspace never show, even before this
      // scope's own read lands.
      rooms = held.scope === scope ? held.rooms : null;
    }
  } else {
    const matchingSnapshot =
      latestSnapshot &&
      latestSnapshot.currentUserId === currentUserId &&
      latestSnapshot.organizationId === organizationId
        ? latestSnapshot
        : null;
    if (matchingSnapshot && (livePublisherCount > 0 || trackedScope !== null)) {
      rooms = getOverlaidSnapshotRooms(matchingSnapshot);
    } else {
      rooms = held.scope === scope ? held.rooms : null;
    }
  }

  const failed =
    rooms === null &&
    (attachedReaders.size > 0 || preserveHeld) &&
    failedScope === scope;
  const cached = cachedReadByScope.get(scope);
  if (cached && cached.failed === failed && cached.rooms === rooms) {
    return cached;
  }

  const next: LiveChatRoomsReadSnapshot = { rooms, failed };
  cachedReadByScope.set(scope, next);
  return next;
}

export function getServerLiveChatRoomsReadSnapshot(): LiveChatRoomsReadSnapshot {
  return EMPTY_LIVE_READ;
}

export function publishMembershipVisibleRooms(
  rooms: readonly ChatRoom[],
  organizationId: string | null,
  currentUserId = "",
  sourceRooms?: readonly ChatRoom[],
): void {
  snapshotOrganizationKey = organizationKey(organizationId);
  snapshot = rooms;
  snapshotCurrentUserId = currentUserId;
  snapshotSourceRooms = sourceRooms;
  rebuildLatestSnapshot();
  const didMirror = attachedReaders.size > 0 ? syncMirroredSnapshot() : false;
  if (attachedReaders.size === 0) {
    cachedReadByScope.clear();
  }
  notifyListeners();
  if (didMirror) {
    notifyLiveRoomsListeners();
  }
}

/**
 * A mounted sidebar list that reads the active collection itself. While one
 * is live, the tab unread indicator mirrors its rows instead of running a
 * second reader for the same collection.
 */
export function registerMembershipVisibleRoomsPublisher(): () => void {
  livePublisherCount += 1;
  const didMirror = attachedReaders.size > 0 ? syncMirroredSnapshot() : false;
  notifyListeners();
  if (didMirror) {
    notifyLiveRoomsListeners();
  }
  return () => {
    livePublisherCount -= 1;
    const didMirrorOnUnregister =
      attachedReaders.size > 0 ? syncMirroredSnapshot() : false;
    notifyListeners();
    if (didMirrorOnUnregister) {
      notifyLiveRoomsListeners();
    }
  };
}

export function hasLiveMembershipVisibleRoomsPublisher(): boolean {
  return livePublisherCount > 0;
}

export function clearMembershipVisibleRoomsSnapshot(): void {
  snapshotOrganizationKey = null;
  snapshot = EMPTY_ROOMS;
  snapshotCurrentUserId = "";
  snapshotSourceRooms = undefined;
  latestSnapshot = null;
  if (attachedReaders.size === 0) {
    resetDetachedReaderState();
  } else {
    syncMirroredSnapshot();
  }
  notifyListeners();
}

export function subscribeMembershipVisibleRooms(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getMembershipVisibleRooms(
  organizationId: string | null,
): readonly ChatRoom[] {
  if (snapshotOrganizationKey !== organizationKey(organizationId)) {
    return EMPTY_ROOMS;
  }
  return snapshot;
}

/**
 * Latest in-session membership-visible rooms, regardless of org key.
 * `null` until the list has published at least once this session (cold Instant).
 * Stable reference until the next publish/clear (for useSyncExternalStore).
 */
export function getLatestMembershipVisibleRoomsSnapshot(): MembershipVisibleRoomsSnapshot | null {
  return latestSnapshot;
}
