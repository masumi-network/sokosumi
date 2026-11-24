// @vitest-environment happy-dom

import type { ChatRoom } from "@sokosumi/core-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));

import { CHAT_HEALTHY_REFRESH_MS } from "./chat-refresh-scheduler";
import {
  acquireLiveChatRoomsReader,
  LIVE_CHAT_ROOMS_FALLBACK_MS,
  type LiveChatRoomsAnswer,
} from "./live-chat-rooms-reader";
import { clearRoomReadOverlays } from "./room-read-overlay";

function room(id: string): ChatRoom {
  return {
    id,
    name: id,
    kind: "channel",
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
    updatedAt: new Date("2026-11-24T10:00:00Z"),
  } as ChatRoom;
}

describe("live-chat-rooms-reader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ rooms: [], nextCursor: null });
    clearRoomReadOverlays();
    resetChatReadThrottleForTests();
  });

  afterEach(() => {
    clearRoomReadOverlays();
    resetChatReadThrottleForTests();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shares one scheduler and one timer cadence across surfaces on the same scope (D1)", async () => {
    const answers1: LiveChatRoomsAnswer[] = [];
    const answers2: LiveChatRoomsAnswer[] = [];
    const answers3: LiveChatRoomsAnswer[] = [];

    const s1 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => answers1.push(a),
    });
    const s2 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => answers2.push(a),
    });
    const s3 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => answers3.push(a),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    await Promise.resolve();
    await Promise.resolve();
    expect(answers1).toHaveLength(1);
    expect(answers2).toHaveLength(1);
    expect(answers3).toHaveLength(1);

    // Advancing half the interval and attaching another healthy surface must
    // not reset the running 60 s timer.
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS / 2);
    const s4 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS / 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Dropping health switches to the 15 s fallback cadence once.
    s1.setHealth(false);
    s2.setHealth(false);
    await vi.advanceTimersByTimeAsync(LIVE_CHAT_ROOMS_FALLBACK_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Health recovery triggers a single recovery read across all surfaces.
    s1.setHealth(true);
    s2.setHealth(true);
    s3.setHealth(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    s1.release();
    s2.release();
    s3.release();
    s4.release();
  });

  it("returns lastAnswer with no mount read for late attachers and waits when pending (D2)", async () => {
    const firstFetch = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock.mockReturnValueOnce(firstFetch.promise);

    const s1 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    expect(s1.lastAnswer).toBeNull();

    // Attaching while the first read is still pending gets no lastAnswer and
    // triggers no second read.
    const s2Answers: LiveChatRoomsAnswer[] = [];
    const s2 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => s2Answers.push(a),
    });
    expect(s2.lastAnswer).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const rows = [room("r1")];
    firstFetch.resolve({ rooms: rows, nextCursor: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(s2Answers).toHaveLength(1);

    // Attaching after the answer seeds immediately from lastAnswer with no read.
    const s3 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    expect(s3.lastAnswer).toEqual({
      scope: "org-1:user-1",
      revision: s2Answers[0]?.revision,
      rows,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A different scope is completely isolated.
    const other = acquireLiveChatRoomsReader("org-2:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    expect(other.lastAnswer).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    s1.release();
    s2.release();
    s3.release();
    other.release();
  });

  it("broadcasts failures to every attached surface without polluting lastAnswer (D4)", async () => {
    fetchMock.mockResolvedValueOnce(null);

    const a1: LiveChatRoomsAnswer[] = [];
    const a2: LiveChatRoomsAnswer[] = [];
    const s1 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => a1.push(a),
    });
    const s2 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => a2.push(a),
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(a1).toHaveLength(1);
    expect(a2).toHaveLength(1);
    expect(a1[0]?.page).toBeNull();
    expect(a2[0]?.page).toBeNull();

    const s3 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    expect(s3.lastAnswer).toBeNull();

    s1.release();
    s2.release();
    s3.release();
  });

  it("coalesces same-turn requests from distinct surfaces into one read while preserving back-to-back events", async () => {
    const s1 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    const s2 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    const s3 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    fetchMock.mockClear();

    // One event hitting three surfaces in the same synchronous turn: one read,
    // no queued follow-up.
    const req1 = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock.mockReturnValueOnce(req1.promise);
    s1.request();
    s2.request();
    s3.request();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    req1.resolve({ rooms: [room("r1")], nextCursor: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Two distinct events in the same turn (same surface requests twice): one
    // in-flight read plus one queued follow-up.
    const req2 = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock
      .mockReturnValueOnce(req2.promise)
      .mockResolvedValueOnce({ rooms: [room("r2")], nextCursor: null });
    s1.request();
    s2.request();
    s3.request();
    s1.request();
    s2.request();
    s3.request();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    req2.resolve({ rooms: [room("r1")], nextCursor: null });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(3);

    s1.release();
    s2.release();
    s3.release();
  });

  it("removes timers and window listeners on last release and starts the next mount fresh", async () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");

    const pending = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();
    fetchMock
      .mockResolvedValueOnce({ rooms: [room("r1")], nextCursor: null })
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ rooms: [room("r2")], nextCursor: null });

    const seen: LiveChatRoomsAnswer[] = [];
    const s1 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => seen.push(a),
    });
    const s2 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: (a) => seen.push(a),
    });
    await Promise.resolve();
    await Promise.resolve();

    // Releasing one keeps the scheduler running.
    s1.release();
    s2.request();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Releasing the last surface stops timers/listeners and drops the in-flight answer.
    s2.release();
    expect(removeSpy.mock.calls.length).toBeGreaterThanOrEqual(
      addSpy.mock.calls.length,
    );

    const beforeResolve = seen.length;
    pending.resolve({ rooms: [room("stale")], nextCursor: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toHaveLength(beforeResolve);

    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Next mount starts as a fresh first reader (no stale lastAnswer, runs mount read).
    const s3 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {},
    });
    expect(s3.lastAnswer).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    s3.release();
  });

  it("handles a surface releasing itself or another surface synchronously inside onAnswer", async () => {
    const receivedBy2 = vi.fn();
    let s2: ReturnType<typeof acquireLiveChatRoomsReader> | null = null;
    const s1 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: () => {
        s1.release();
        s2?.release();
      },
    });
    s2 = acquireLiveChatRoomsReader("org-1:user-1", {
      healthy: true,
      onAnswer: receivedBy2,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(receivedBy2).not.toHaveBeenCalled();
    // Both released -> scheduler stopped.
    await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
