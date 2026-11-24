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
  /** Surface health history from before this attach, used to prime a new scheduler. */
  healthHistory?: LiveChatRoomsHealthHistory;
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
}

interface LiveChatRoomsScopeEntry {
  surfaces: Set<LiveChatRoomsSurface>;
  scheduler: ChatRefreshScheduler;
  getLastAnswer: () => LiveChatRoomsCachedAnswer | null;
  request: (surface: LiveChatRoomsSurface) => void;
  setHealth: (healthy: boolean) => void;
}

const entriesByScope = new Map<string, LiveChatRoomsScopeEntry>();

function createScopeEntry(
  scope: string,
  initialHealthy: boolean,
  healthHistory?: LiveChatRoomsHealthHistory,
): LiveChatRoomsScopeEntry {
  const surfaces = new Set<LiveChatRoomsSurface>();
  let currentHealthy = healthHistory
    ? healthHistory.wasHealthy
    : initialHealthy;
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
    healthy: currentHealthy,
    getHealthy: () => currentHealthy,
    fallbackIntervalMs: LIVE_CHAT_ROOMS_FALLBACK_MS,
    refreshOnMount: true,
    refreshOnRecovery: true,
  });

  if (healthHistory?.hadHealthy && !healthHistory.wasHealthy) {
    // Scheduler is still stopped: restore hadHealthy=true, wasHealthy=false
    // without starting a read so applying health after start() reproduces
    // main's recovery read across stop/start (Activity reveal, scope switch).
    scheduler.setHealth(true, false);
    scheduler.setHealth(false, false);
  }

  return {
    surfaces,
    scheduler,
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
      currentHealthy = healthy;
      scheduler.setHealth(healthy, true);
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
    entry = createScopeEntry(scope, options.healthy, options.healthHistory);
    entriesByScope.set(scope, entry);
  }

  const activeEntry = entry;
  const surface: LiveChatRoomsSurface = {
    onAnswer: options.onAnswer,
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
    activeEntry.setHealth(options.healthy);
  }

  return subscription;
}

export function resetLiveChatRoomsReaderForTests(): void {
  for (const entry of entriesByScope.values()) {
    entry.scheduler.stop();
  }
  entriesByScope.clear();
}
