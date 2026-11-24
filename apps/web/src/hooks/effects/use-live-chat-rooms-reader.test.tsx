// @vitest-environment happy-dom

import type { ChatRoom } from "@sokosumi/core-client";
import { act, render, renderHook } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHAT_HEALTHY_REFRESH_MS } from "@/components/chat/chat-refresh-scheduler";
import {
  LIVE_CHAT_ROOMS_FALLBACK_MS,
  type LiveChatRoomsAnswer,
  type LiveChatRoomsCachedAnswer,
} from "@/components/chat/live-chat-rooms-reader";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { resetChatReadThrottleForTests } from "@/lib/chat/chat-read-throttle";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));

import { useLiveChatRoomsReader } from "./use-live-chat-rooms-reader";

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

describe("useLiveChatRoomsReader", () => {
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

  it("attaches on non-null scope, seeds late attachers, forwards health, and ignores request while detached", async () => {
    const firstRooms = [room("r1")];
    fetchMock.mockResolvedValue({ rooms: firstRooms, nextCursor: null });

    const answers1: LiveChatRoomsAnswer[] = [];
    const seeds1: LiveChatRoomsCachedAnswer[] = [];

    const first = renderHook(
      ({ scope, healthy }: { scope: string | null; healthy: boolean }) =>
        useLiveChatRoomsReader({
          scope,
          healthy,
          onAnswer: (a) => answers1.push(a),
          onSeed: (s) => seeds1.push(s),
        }),
      { initialProps: { scope: null as string | null, healthy: true } },
    );

    // Detached: no fetch and request() is a no-op.
    act(() => {
      first.result.current();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // Attach to org-1:user-1 -> starts first read.
    await act(async () => {
      first.rerender({ scope: "org-1:user-1", healthy: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answers1).toHaveLength(1);
    expect(seeds1).toHaveLength(0);

    // Second hook attaches after answer -> seeds immediately, no mount read.
    const seeds2: LiveChatRoomsCachedAnswer[] = [];
    const second = renderHook(() =>
      useLiveChatRoomsReader({
        scope: "org-1:user-1",
        healthy: true,
        onAnswer: () => {},
        onSeed: (s) => seeds2.push(s),
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seeds2).toEqual([
      {
        scope: "org-1:user-1",
        revision: answers1[0]?.revision,
        rows: firstRooms,
      },
    ]);

    // Health drop switches cadence to fallback 15 s.
    act(() => {
      first.rerender({ scope: "org-1:user-1", healthy: false });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_CHAT_ROOMS_FALLBACK_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Detaching both stops timers.
    first.unmount();
    second.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("detaches on React Activity hide and re-attaches on Activity reveal under StrictMode", async () => {
    const onAnswer = vi.fn();
    const onSeed = vi.fn();

    function Probe() {
      useLiveChatRoomsReader({
        scope: "org-1:user-1",
        healthy: true,
        onAnswer,
        onSeed,
      });
      return null;
    }

    const view = render(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const callsAfterMount = fetchMock.mock.calls.length;

    view.rerender(
      <StrictMode>
        <Activity mode="hidden">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHAT_HEALTHY_REFRESH_MS * 2);
    });
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterMount);

    view.rerender(
      <StrictMode>
        <Activity mode="visible">
          <Probe />
        </Activity>
      </StrictMode>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount);

    view.unmount();
  });
});
