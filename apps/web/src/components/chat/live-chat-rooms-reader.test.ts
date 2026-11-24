// @vitest-environment happy-dom

import type { ChatRoom } from "@sokosumi/core-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOBILE_BREAKPOINT } from "@/hooks/effects/use-mobile";
import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));

import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";
import { CHAT_HEALTHY_REFRESH_MS } from "./chat-refresh-scheduler";
import {
  acquireLiveChatRoomsScheduler,
  acquireLiveChatRoomsWindowListeners,
  attachLiveChatRoomsReader,
  clearMembershipVisibleRoomsSnapshot,
  getLiveChatRoomsOwnershipSettledSnapshot,
  getLiveChatRoomsReadSnapshot,
  hasLiveMembershipVisibleRoomsPublisher,
  type LiveChatRoomsReaderHandle,
  liveChatRoomsScope,
  publishMembershipVisibleRooms,
  registerMembershipVisibleRoomsPublisher,
  SIDEBAR_REGISTRATION_WAIT_MS,
  subscribeLiveChatRoomsOwnershipSettled,
  subscribeLiveChatRoomsReader,
  subscribeMembershipVisibleRooms,
} from "./membership-visible-rooms-store";
import {
  ORGANIZATION_CHAT_ROOM_READ_EVENT,
  ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
} from "./organization-chat-events";
import { clearRoomReadOverlays } from "./room-read-overlay";

interface DrivenReader {
  handle: LiveChatRoomsReaderHandle;
  setScope: (organizationId: string | null, currentUserId: string) => void;
  setHealth: (healthy: boolean) => void;
  detach: () => void;
}

/**
 * Pure module driver (no React) matching `useLiveChatRoomsReader`'s ownership
 * subscription and passive scheduler/listener ordering.
 */
function mountModuleReader(
  options: {
    organizationId?: string | null;
    currentUserId?: string;
    healthy?: boolean;
    isReveal?: boolean;
  } = {},
): DrivenReader {
  let orgId =
    "organizationId" in options ? (options.organizationId ?? null) : "org-1";
  let userId = options.currentUserId ?? "user-1";
  const healthy = options.healthy ?? true;
  const isReveal = options.isReveal ?? false;
  let detached = false;
  let releaseScheduler: (() => void) | null = null;
  let currentKey: string | null = null;

  function syncScheduler() {
    if (detached) return;
    const scope = liveChatRoomsScope(orgId, userId);
    const settled = getLiveChatRoomsOwnershipSettledSnapshot(isReveal);
    const nextKey =
      scope && settled && !hasLiveMembershipVisibleRoomsPublisher()
        ? `${scope}:unread`
        : null;
    if (nextKey === currentKey) return;
    const prev = releaseScheduler;
    releaseScheduler = null;
    currentKey = nextKey;
    prev?.();
    if (nextKey !== null) {
      const release = acquireLiveChatRoomsScheduler(nextKey);
      if (detached) {
        release();
      } else {
        releaseScheduler = release;
      }
    }
  }

  const handle = attachLiveChatRoomsReader({
    organizationId: orgId,
    currentUserId: userId,
    healthy,
    isReveal,
  });
  const unsubOwnership = subscribeLiveChatRoomsOwnershipSettled(syncScheduler);
  const unsubPublisher = subscribeMembershipVisibleRooms(syncScheduler);
  syncScheduler();
  const releaseListeners = acquireLiveChatRoomsWindowListeners();

  return {
    handle,
    setScope(nextOrgId, nextUserId) {
      orgId = nextOrgId;
      userId = nextUserId;
      handle.commitRenderState(nextOrgId, nextUserId, healthy);
      handle.setScope(nextOrgId, nextUserId);
      syncScheduler();
    },
    setHealth(nextHealthy) {
      handle.commitRenderState(orgId, userId, nextHealthy);
      handle.setHealth(nextHealthy);
    },
    detach() {
      if (detached) return;
      detached = true;
      unsubOwnership();
      unsubPublisher();
      const prev = releaseScheduler;
      releaseScheduler = null;
      currentKey = null;
      prev?.();
      releaseListeners();
      handle.detach();
    },
  };
}

describe("membership-visible-rooms-store live rooms reader", () => {
  let hasFocus: ReturnType<typeof vi.spyOn>;
  let visibility: ReturnType<typeof vi.spyOn>;
  const readers: DrivenReader[] = [];

  function attach(
    options: Parameters<typeof mountModuleReader>[0] = {},
  ): DrivenReader {
    const reader = mountModuleReader(options);
    readers.push(reader);
    return reader;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    resetChatReadThrottleForTests();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ rooms: [], nextCursor: null });
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  });

  afterEach(() => {
    while (readers.length > 0) {
      readers.pop()?.detach();
    }
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    resetChatReadThrottleForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("settles immediately below the mobile breakpoint and waits SIDEBAR_REGISTRATION_WAIT_MS at or above it", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const mobile = attach();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    mobile.detach();

    fetchMock.mockClear();
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT);
    const desktop = attach();
    await vi.advanceTimersByTimeAsync(SIDEBAR_REGISTRATION_WAIT_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    desktop.detach();
  });

  it("Interleaving 16: three readers on a phone share one active GET on a message and hold the same array", async () => {
    const initial = [makeRoom({ id: "room-a", unreadCount: 0 })];
    const updated = [makeRoom({ id: "room-a", unreadCount: 2 })];
    fetchMock
      .mockResolvedValueOnce({ rooms: initial, nextCursor: null })
      .mockResolvedValueOnce({ rooms: updated, nextCursor: null });

    const r1 = attach({ healthy: true });
    const r2 = attach({ healthy: true });
    const r3 = attach({ healthy: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    // Archived invalidation does not trigger a read.
    window.dispatchEvent(
      new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
        detail: { collections: ["archived"] },
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();

    // One message in the active collection triggers exactly one active GET.
    window.dispatchEvent(
      new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
        detail: { collections: ["active"], roomId: "room-a" },
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");

    const snap1 = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    const snap2 = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    const snap3 = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    expect(snap1.rooms).toHaveLength(1);
    expect(snap1.rooms?.[0]?.unreadCount).toBe(2);
    expect(snap1.rooms).toBe(snap2.rooms);
    expect(snap2.rooms).toBe(snap3.rooms);

    r1.detach();
    r2.detach();
    r3.detach();
  });

  it("D1: three healthy readers run one timer read after 60 s", async () => {
    const r1 = attach({ healthy: true });
    const r2 = attach({ healthy: true });
    const r3 = attach({ healthy: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");

    r1.detach();
    r2.detach();
    r3.detach();
  });

  it("D2: a fourth reader mounting later gets rows at once and causes no read", async () => {
    const rows = [makeRoom({ id: "room-1", unreadCount: 1 })];
    fetchMock.mockResolvedValue({ rooms: rows, nextCursor: null });

    const r1 = attach({ healthy: true });
    const r2 = attach({ healthy: true });
    const r3 = attach({ healthy: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const existingSnap = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    expect(existingSnap.rooms?.map((r) => r.id)).toEqual(["room-1"]);

    fetchMock.mockClear();
    const r4 = attach({ healthy: true });
    const fourthSnap = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    expect(fourthSnap.rooms).toBe(existingSnap.rooms);
    expect(fetchMock).not.toHaveBeenCalled();

    r1.detach();
    r2.detach();
    r3.detach();
    r4.detach();
  });

  it("D3: desktop wait is counted from the first reader's attach, not per surface", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT + 200);
    const r1 = attach({ healthy: true });

    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).not.toHaveBeenCalled();

    const r2 = attach({ healthy: true });
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).not.toHaveBeenCalled();

    // 2 000 ms from r1's attach (only 500 ms from r2's attach): one read starts.
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 2 000 ms after r2's attach: no second read.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    r1.detach();
    r2.detach();
  });

  it("D4: a failed first read shows as failed to every surface, then clears on retry", async () => {
    fetchMock.mockResolvedValueOnce(null).mockResolvedValueOnce({
      rooms: [makeRoom({ id: "room-recovered" })],
      nextCursor: null,
    });

    const notifications = vi.fn();
    const unsubscribe = subscribeLiveChatRoomsReader(notifications);
    try {
      const r1 = attach({ healthy: false });
      const r2 = attach({ healthy: false });
      await vi.advanceTimersByTimeAsync(0);

      expect(getLiveChatRoomsReadSnapshot("org-1", "user-1")).toEqual({
        rooms: null,
        failed: true,
      });

      // A third surface mounting while failed sees the failure at once with no extra read.
      const r3 = attach({ healthy: false });
      expect(getLiveChatRoomsReadSnapshot("org-1", "user-1")).toEqual({
        rooms: null,
        failed: true,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Unhealthy fallback retry succeeds after 15 s.
      await vi.advanceTimersByTimeAsync(15_000);
      const after = getLiveChatRoomsReadSnapshot("org-1", "user-1");
      expect(after.failed).toBe(false);
      expect(after.rooms?.map((r) => r.id)).toEqual(["room-recovered"]);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      r1.detach();
      r2.detach();
      r3.detach();
    } finally {
      unsubscribe();
    }
  });

  it("Rule 3 with two readers: when the live list unmounts, exactly one takeover read starts and mirrored rows stay until it lands", async () => {
    const unregisterPublisher = registerMembershipVisibleRoomsPublisher();
    publishMembershipVisibleRooms(
      [makeRoom({ id: "mirrored", unreadCount: 3 })],
      "org-1",
      "user-1",
    );

    const pendingTakeover = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock.mockReturnValueOnce(pendingTakeover.promise);

    const r1 = attach({ healthy: true });
    const r2 = attach({ healthy: true });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      getLiveChatRoomsReadSnapshot("org-1", "user-1").rooms?.map((r) => r.id),
    ).toEqual(["mirrored"]);

    unregisterPublisher();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    // Mirrored rows stay while takeover read is in flight.
    expect(
      getLiveChatRoomsReadSnapshot("org-1", "user-1").rooms?.map((r) => r.id),
    ).toEqual(["mirrored"]);

    pendingTakeover.resolve({
      rooms: [makeRoom({ id: "fresh", unreadCount: 1 })],
      nextCursor: null,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(
      getLiveChatRoomsReadSnapshot("org-1", "user-1").rooms?.map((r) => r.id),
    ).toEqual(["fresh"]);

    r1.detach();
    r2.detach();
  });

  it("removes timers and window listeners when the last reader detaches and restarts fresh on next attach", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT + 100);
    const r1 = attach({ healthy: false });
    const r2 = attach({ healthy: false });

    const addedRoomRead = addSpy.mock.calls.filter(
      ([type]) => type === ORGANIZATION_CHAT_ROOM_READ_EVENT,
    );
    const addedRoomsChanged = addSpy.mock.calls.filter(
      ([type]) => type === ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
    );
    expect(addedRoomRead).toHaveLength(1);
    expect(addedRoomsChanged).toHaveLength(1);

    // Detaching one of two readers keeps listeners and desktop wait alive.
    r1.detach();
    expect(
      removeSpy.mock.calls.filter(
        ([type]) => type === ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      ),
    ).toHaveLength(0);

    // Detaching the last reader clears the desktop wait timer and removes listeners.
    r2.detach();
    expect(
      removeSpy.mock.calls.filter(
        ([type]) => type === ORGANIZATION_CHAT_ROOM_READ_EVENT,
      ),
    ).toHaveLength(1);
    expect(
      removeSpy.mock.calls.filter(
        ([type]) => type === ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT,
      ),
    ).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SIDEBAR_REGISTRATION_WAIT_MS * 2);
    window.dispatchEvent(new Event(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT));
    expect(fetchMock).not.toHaveBeenCalled();

    // Mounting again starts as a first reader: waits full 2 s on desktop.
    const r3 = attach({ healthy: false });
    await vi.advanceTimersByTimeAsync(SIDEBAR_REGISTRATION_WAIT_MS - 1);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    r3.detach();

    // Narrowing to mobile before re-attaching settles immediately without a 2 s wait.
    fetchMock.mockClear();
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const r4 = attach({ healthy: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    r4.detach();
  });

  it("cleans up cleanly if the reader detaches synchronously inside the first fetch callback", async () => {
    const handle = attachLiveChatRoomsReader({
      organizationId: "org-1",
      currentUserId: "user-1",
      healthy: false,
    });
    fetchMock.mockImplementationOnce(async () => {
      handle.detach();
      return {
        rooms: [makeRoom({ id: "should-be-dropped" })],
        nextCursor: null,
      };
    });

    const releaseScheduler = acquireLiveChatRoomsScheduler(
      "org-1:user-1:unread",
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(getLiveChatRoomsReadSnapshot("org-1", "user-1")).toEqual({
      rooms: null,
      failed: false,
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    releaseScheduler();
  });

  it("shares Ably health transitions across readers without spurious reads on drop and runs one recovery read on reconnect", async () => {
    const r1 = attach({ healthy: true });
    const r2 = attach({ healthy: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    r1.setHealth(false);
    r2.setHealth(false);
    expect(fetchMock).not.toHaveBeenCalled();

    r1.setHealth(true);
    r2.setHealth(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");

    r1.detach();
    r2.detach();
  });

  it("keeps foreground/background tracking active on the single shared scheduler", async () => {
    const r1 = attach({ healthy: true });
    await vi.advanceTimersByTimeAsync(0);
    fetchMock.mockClear();

    visibility.mockReturnValue("hidden");
    hasFocus.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS);
    expect(fetchMock).not.toHaveBeenCalled();

    visibility.mockReturnValue("visible");
    hasFocus.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    r1.detach();
  });

  it("drops an in-flight answer (rows or failure) when commitRenderState moves scope before setScope stops the scheduler", async () => {
    const pendingRows = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    } | null>();
    fetchMock.mockReturnValueOnce(pendingRows.promise);

    const r1 = attach({ organizationId: "org-1", healthy: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Layout phase commits org-2 before passive setScope runs.
    r1.handle.commitRenderState("org-2", "user-1", true);
    pendingRows.resolve(null);
    await vi.advanceTimersByTimeAsync(0);

    // Failure for org-1 was dropped, never stored for org-1 or org-2.
    expect(getLiveChatRoomsReadSnapshot("org-1", "user-1")).toEqual({
      rooms: null,
      failed: false,
    });
    expect(getLiveChatRoomsReadSnapshot("org-2", "user-1")).toEqual({
      rooms: null,
      failed: false,
    });

    r1.detach();
  });

  it("caches getLiveChatRoomsReadSnapshot on snapshot+overlay identity and reflects metadata updates (name, starredAt) before passive setScope", () => {
    const unregisterPublisher = registerMembershipVisibleRoomsPublisher();
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    publishMembershipVisibleRooms(
      [
        makeRoom({
          id: "room-a",
          name: "old-name",
          starredAt: null,
          updatedAt,
        }),
      ],
      "org-1",
      "user-1",
    );

    // Reader attaches while session is still pending (`currentUserId: ""`).
    const r1 = attach({ organizationId: null, currentUserId: "" });

    // Repeated reads on the same snapshot return the exact same object reference.
    const first = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    const second = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    expect(first).toBe(second);
    expect(first.rooms?.[0]?.name).toBe("old-name");
    expect(first.rooms?.[0]?.starredAt).toBeNull();

    // New row object with identical id/updatedAt/attention but updated name & starredAt
    // published before passive setScope must not be masked by a partial comparison cache.
    const starredAt = new Date("2026-02-01T00:00:00.000Z");
    publishMembershipVisibleRooms(
      [makeRoom({ id: "room-a", name: "new-name", starredAt, updatedAt })],
      "org-1",
      "user-1",
    );
    const updated = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    const updatedAgain = getLiveChatRoomsReadSnapshot("org-1", "user-1");
    expect(updated).not.toBe(first);
    expect(updated).toBe(updatedAgain);
    expect(updated.rooms?.[0]?.name).toBe("new-name");
    expect(updated.rooms?.[0]?.starredAt).toEqual(starredAt);

    r1.detach();
    unregisterPublisher();
  });

  it("reconciles second-reader scope before applying health recovery so no recovery read fires on the old scope", async () => {
    const r1 = attach({ organizationId: "org-1", healthy: true });
    await vi.advanceTimersByTimeAsync(0);
    r1.setHealth(false);
    fetchMock.mockClear();

    // Second reader attaches on org-2 with healthy: true (without calling setHealth yet).
    const h2 = attachLiveChatRoomsReader({
      organizationId: "org-2",
      currentUserId: "user-1",
      healthy: true,
    });
    // Attaching alone reconciles scope to org-2 without firing a recovery read on org-1.
    expect(fetchMock).not.toHaveBeenCalled();

    h2.detach();
    r1.detach();
  });
});
