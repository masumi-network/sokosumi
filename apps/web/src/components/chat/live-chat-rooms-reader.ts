import type { ChatRoom } from "@sokosumi/core-client";

import {
  type ChatRefreshScheduler,
  createChatRefreshScheduler,
} from "./chat-refresh-scheduler";
import { fetchSidebarRoomCollection } from "./fetch-sidebar-room-collection";
import { beginRoomAttentionRefresh } from "./room-read-overlay";

/** Poll cadence while the Ably connection is unavailable. */
export const LIVE_CHAT_ROOMS_FALLBACK_MS = 15_000;

export interface LiveChatRoomsPage {
  rooms: ChatRoom[];
  nextCursor: string | null;
}

export interface LiveChatRoomsAnswer {
  scope: string;
  revision: number;
  page: LiveChatRoomsPage | null;
}

export interface LiveChatRoomsCachedAnswer {
  scope: string;
  revision: number;
  rows: readonly ChatRoom[];
}

export interface LiveChatRoomsHealthHistory {
  hadHealthy: boolean;
  wasHealthy: boolean;
}

export interface AcquireLiveChatRoomsReaderOptions {
  healthy: boolean;
  /** Live getter for this surface's hook-lifetime health history (D5). */
  getHealthHistory?: () => LiveChatRoomsHealthHistory;
  onAnswer: (answer: LiveChatRoomsAnswer) => void;
}

export interface LiveChatRoomsReaderSubscription {
  /** Last successful answer for this scope if already fetched before attach. */
  lastAnswer: LiveChatRoomsCachedAnswer | null;
  request: () => void;
  setHealth: (healthy: boolean) => void;
  release: () => void;
}

interface LiveChatRoomsSurface {
  onAnswer: (answer: LiveChatRoomsAnswer) => void;
  getHealthHistory: () => LiveChatRoomsHealthHistory;
}

interface LiveChatRoomsScopeEntry {
  surfaces: Set<LiveChatRoomsSurface>;
  scheduler: ChatRefreshScheduler;
  isHealthy: () => boolean;
  getLastAnswer: () => LiveChatRoomsCachedAnswer | null;
  request: (surface: LiveChatRoomsSurface) => void;
  setHealth: (healthy: boolean) => void;
}

const entriesByScope = new Map<string, LiveChatRoomsScopeEntry>();

function surfaceNeedsRecovery(surface: LiveChatRoomsSurface): boolean {
  const history = surface.getHealthHistory();
  return history.hadHealthy && !history.wasHealthy;
}

function anySurfaceNeedsRecovery(
  surfaces: ReadonlySet<LiveChatRoomsSurface>,
): boolean {
  for (const surface of surfaces) {
    if (surfaceNeedsRecovery(surface)) {
      return true;
    }
  }
  return false;
}

function createScopeEntry(
  scope: string,
  initialHealthy: boolean,
): LiveChatRoomsScopeEntry {
  const surfaces = new Set<LiveChatRoomsSurface>();
  let currentHealthy = initialHealthy;
  let lastAnswer: LiveChatRoomsCachedAnswer | null = null;
  // Every attached surface listens to the same window invalidation event and
  // forwards it in the same synchronous turn; coalesce distinct surfaces per
  // turn so one event starts one read with no extra follow-up, while a second
  // event from any already-seen surface still queues a follow-up.
  let requestBatch: Set<LiveChatRoomsSurface> | null = null;

  const scheduler = createChatRefreshScheduler({
    refresh: async (isCurrent) => {
      const revision = beginRoomAttentionRefresh();
      const page = await fetchSidebarRoomCollection("active");
      if (!isCurrent()) return;
      if (page && (!lastAnswer || revision >= lastAnswer.revision)) {
        lastAnswer = { scope, revision, rows: page.rooms };
      }
      const answer: LiveChatRoomsAnswer = { scope, revision, page };
      for (const surface of [...surfaces]) {
        if (surfaces.has(surface)) {
          surface.onAnswer(answer);
        }
      }
    },
    healthy: initialHealthy,
    getHealthy: () => currentHealthy,
    fallbackIntervalMs: LIVE_CHAT_ROOMS_FALLBACK_MS,
    refreshOnMount: true,
    // D5: recovery eligibility is decided from the attached surfaces'
    // hook-lifetime histories, not the scheduler's own retained history.
    refreshOnRecovery: false,
  });

  return {
    surfaces,
    scheduler,
    isHealthy: () => currentHealthy,
    getLastAnswer: () => lastAnswer,
    request: (surface) => {
      if (!surfaces.has(surface)) return;
      if (requestBatch === null || requestBatch.has(surface)) {
        const batch = new Set<LiveChatRoomsSurface>([surface]);
        requestBatch = batch;
        queueMicrotask(() => {
          if (requestBatch === batch) {
            requestBatch = null;
          }
        });
        scheduler.request();
        return;
      }
      requestBatch.add(surface);
    },
    setHealth: (healthy) => {
      if (healthy === currentHealthy) return;
      const wasHealthy = currentHealthy;
      currentHealthy = healthy;
      scheduler.setHealth(healthy, false);
      if (healthy && !wasHealthy && anySurfaceNeedsRecovery(surfaces)) {
        scheduler.request();
      }
    },
  };
}

/**
 * Acquires the shared live-rooms reader for `scope`.
 *
 * The first attached surface starts one `createChatRefreshScheduler` for that
 * scope; later surfaces share the scheduler, receive every broadcast answer or
 * failure, and see `lastAnswer` immediately without triggering a mount read.
 * Releasing the last surface stops the scheduler and clears the scope entry.
 */
export function acquireLiveChatRoomsReader(
  scope: string,
  options: AcquireLiveChatRoomsReaderOptions,
): LiveChatRoomsReaderSubscription {
  let entry = entriesByScope.get(scope);
  const isFirst = !entry;
  if (!entry) {
    entry = createScopeEntry(scope, options.healthy);
    entriesByScope.set(scope, entry);
  }

  const activeEntry = entry;
  const localHistory: LiveChatRoomsHealthHistory = {
    hadHealthy: options.healthy,
    wasHealthy: options.healthy,
  };
  const surface: LiveChatRoomsSurface = {
    onAnswer: options.onAnswer,
    getHealthHistory: options.getHealthHistory ?? (() => localHistory),
  };
  activeEntry.surfaces.add(surface);

  let released = false;
  const subscription: LiveChatRoomsReaderSubscription = {
    lastAnswer: activeEntry.getLastAnswer(),
    request: () => {
      if (released) return;
      activeEntry.request(surface);
    },
    setHealth: (healthy: boolean) => {
      if (released) return;
      activeEntry.setHealth(healthy);
      localHistory.hadHealthy ||= healthy;
      localHistory.wasHealthy = healthy;
    },
    release: () => {
      if (released) return;
      released = true;
      activeEntry.surfaces.delete(surface);
      if (activeEntry.surfaces.size === 0) {
        if (entriesByScope.get(scope) === activeEntry) {
          entriesByScope.delete(scope);
        }
        activeEntry.scheduler.stop();
      }
    },
  };

  if (isFirst) {
    activeEntry.scheduler.start();
  }
  if (!released) {
    if (options.healthy !== activeEntry.isHealthy()) {
      activeEntry.setHealth(options.healthy);
    } else if (options.healthy && surfaceNeedsRecovery(surface)) {
      // Surface reattached after Ably recovered while it was detached/hidden:
      // apply its pending recovery read after start().
      activeEntry.request(surface);
    }
  }

  return subscription;
}

export function resetLiveChatRoomsReaderForTests(): void {
  for (const entry of entriesByScope.values()) {
    entry.scheduler.stop();
  }
  entriesByScope.clear();
}
