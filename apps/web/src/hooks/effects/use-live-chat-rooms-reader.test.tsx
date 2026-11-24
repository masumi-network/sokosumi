import type { ChatRoom } from "@sokosumi/core-client";
import { act, render } from "@testing-library/react";
import { Activity, StrictMode, useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, controlSubscribe, controlClient, sessionState } = vi.hoisted(
  () => {
    const controlSubscribe = vi.fn();
    return {
      fetchMock: vi.fn(),
      controlSubscribe,
      controlClient: {
        connection: { state: "connected", on: vi.fn(), off: vi.fn() },
        channels: {
          get: () => ({ subscribe: controlSubscribe, unsubscribe: vi.fn() }),
        },
      },
      sessionState: {
        userId: "user-1",
        organizationId: "org-1" as string | null,
      },
    };
  },
);

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));
vi.mock("ably/react", () => ({ useAbly: () => controlClient }));
vi.mock("@/contexts/lazy-ably-provider", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: sessionState.userId
      ? {
          user: { id: sessionState.userId },
          session: { activeOrganizationId: sessionState.organizationId },
        }
      : null,
  }),
}));

import { makeRoom } from "@/components/chat/__tests__/chat-room-fixtures";
import { ChatControlListBridge } from "@/components/chat/chat-control-list-bridge";
import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
  registerMembershipVisibleRoomsPublisher,
  SIDEBAR_REGISTRATION_WAIT_MS,
} from "@/components/chat/membership-visible-rooms-store";
import { ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT } from "@/components/chat/organization-chat-events";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { useLiveChatRoomsRead } from "@/components/chat/use-live-chat-rooms";
import { setAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { MOBILE_BREAKPOINT } from "./use-mobile";

function ReaderProbe({
  onValue,
}: {
  onValue?: (value: { rooms: ChatRoom[] | null; failed: boolean }) => void;
}) {
  const value = useLiveChatRoomsRead();
  onValue?.(value);
  return null;
}

function SiblingPublisher() {
  useEffect(() => registerMembershipVisibleRoomsPublisher(), []);
  return null;
}

describe("useLiveChatRoomsReader", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ rooms: [], nextCursor: null });
    controlSubscribe.mockClear();
    sessionState.userId = "user-1";
    sessionState.organizationId = "org-1";
    setAblyConnectionHealthy(true);
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    setAblyConnectionHealthy(false);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("re-samples window.innerWidth on React Activity reveal and cleans up timers on StrictMode replay and unmount", async () => {
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT + 200);

    const { rerender, unmount } = render(
      <StrictMode>
        <Activity mode="visible">
          <ReaderProbe />
        </Activity>
      </StrictMode>,
    );
    expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <StrictMode>
        <Activity mode="hidden">
          <ReaderProbe />
        </Activity>
      </StrictMode>,
    );
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

    // Viewport narrows to mobile while hidden: reveal settles immediately without a 2 s wait.
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 100);
    rerender(
      <StrictMode>
        <Activity mode="visible">
          <ReaderProbe />
        </Activity>
      </StrictMode>,
    );
    expect(fetchMock).toHaveBeenCalledWith("active");

    unmount();
  });

  it("makes zero reader calls on a phone when the reader mounts before a sibling publisher in the same commit", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const { unmount } = render(
      <>
        <ReaderProbe />
        <SiblingPublisher />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it("makes zero reader calls when the sole keyed publisher is replaced in one commit (count 1 -> 0 -> 1)", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const { rerender, unmount } = render(
      <>
        <ReaderProbe />
        <SiblingPublisher key="publisher-1" />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(
      <>
        <ReaderProbe />
        <SiblingPublisher key="publisher-2" />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    unmount();
  });

  it("preserves held rows across React Activity hide/reveal while the reveal fetch is pending and starts scheduler before re-subscribing room listeners", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const initialRoom = makeRoom({ id: "room-initial", name: "general" });
    const revealedRoom = makeRoom({ id: "room-revealed", name: "fresh" });
    const revealPending = Promise.withResolvers<{
      rooms: ChatRoom[];
      nextCursor: null;
    }>();

    fetchMock
      .mockResolvedValueOnce({ rooms: [initialRoom], nextCursor: null })
      .mockImplementationOnce(() => {
        // Synchronous active invalidation during reveal fetch must NOT queue a
        // follow-up because room listeners re-subscribe AFTER the scheduler starts.
        window.dispatchEvent(
          new CustomEvent(ORGANIZATION_CHAT_ROOMS_CHANGED_EVENT, {
            detail: { collections: ["active"] },
          }),
        );
        return revealPending.promise;
      });

    let latest: { rooms: ChatRoom[] | null; failed: boolean } = {
      rooms: null,
      failed: false,
    };
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <ReaderProbe
          onValue={(v) => {
            latest = v;
          }}
        />
      </Activity>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(latest.rooms?.map((r) => r.id)).toEqual(["room-initial"]);

    // Hide stops transport/listeners while keeping held rows.
    rerender(
      <Activity mode="hidden">
        <ReaderProbe
          onValue={(v) => {
            latest = v;
          }}
        />
      </Activity>,
    );

    // Reveal starts the next fetch while still showing the held rows.
    rerender(
      <Activity mode="visible">
        <ReaderProbe
          onValue={(v) => {
            latest = v;
          }}
        />
      </Activity>,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest.rooms?.map((r) => r.id)).toEqual(["room-initial"]);

    // Completing the reveal fetch updates rows and triggers 0 queued follow-ups.
    await act(async () => {
      revealPending.resolve({ rooms: [revealedRoom], nextCursor: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(latest.rooms?.map((r) => r.id)).toEqual(["room-revealed"]);

    unmount();
  });

  it("preserves failed state across React Activity hide/reveal while the reveal retry is pending", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    fetchMock
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(new Promise(() => {}));

    let latest: { rooms: ChatRoom[] | null; failed: boolean } = {
      rooms: null,
      failed: false,
    };
    const { rerender, unmount } = render(
      <Activity mode="visible">
        <ReaderProbe
          onValue={(v) => {
            latest = v;
          }}
        />
      </Activity>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(latest).toEqual({ rooms: null, failed: true });

    rerender(
      <Activity mode="hidden">
        <ReaderProbe
          onValue={(v) => {
            latest = v;
          }}
        />
      </Activity>,
    );
    rerender(
      <Activity mode="visible">
        <ReaderProbe
          onValue={(v) => {
            latest = v;
          }}
        />
      </Activity>,
    );
    expect(latest).toEqual({ rooms: null, failed: true });

    unmount();
  });

  it("switches workspace scope on desktop without restarting the 2 s wait", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT + 200);
    const { rerender, unmount } = render(<ReaderProbe />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDEBAR_REGISTRATION_WAIT_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    sessionState.organizationId = "org-2";
    rerender(<ReaderProbe />);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("updates Ably health without triggering a read on drop and runs one recovery read on reconnect", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const { unmount } = render(<ReaderProbe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    act(() => setAblyConnectionHealthy(false));
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => setAblyConnectionHealthy(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("updates live health before starting the scheduler when health and ownership settle together", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT + 200);
    setAblyConnectionHealthy(false);

    const { unmount } = render(<ReaderProbe />);
    expect(fetchMock).not.toHaveBeenCalled();

    // Health becomes true before the desktop 2 s wait settles; when the wait
    // fires, the scheduler starts with the live healthy cadence (60 s), not 15 s.
    act(() => setAblyConnectionHealthy(true));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDEBAR_REGISTRATION_WAIT_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
  });

  it("returns updated row metadata (name) when a new snapshot row object is published before passive scope sync", async () => {
    const unregister = registerMembershipVisibleRoomsPublisher();
    const updatedAt = new Date("2026-01-01T00:00:00.000Z");
    publishMembershipVisibleRooms(
      [makeRoom({ id: "room-a", name: "before-rename", updatedAt })],
      "org-2",
      "user-1",
    );

    let latest: { rooms: ChatRoom[] | null; failed: boolean } = {
      rooms: null,
      failed: false,
    };
    const { rerender, unmount } = render(
      <ReaderProbe
        onValue={(v) => {
          latest = v;
        }}
      />,
    );

    // Switch into org-2 so the pre-commit render reads the preview cache.
    sessionState.organizationId = "org-2";
    rerender(
      <ReaderProbe
        onValue={(v) => {
          latest = v;
        }}
      />,
    );
    expect(latest.rooms?.[0]?.name).toBe("before-rename");

    // Publish a new row object with identical id/updatedAt/attention but new name.
    act(() => {
      publishMembershipVisibleRooms(
        [makeRoom({ id: "room-a", name: "after-rename", updatedAt })],
        "org-2",
        "user-1",
      );
    });
    expect(latest.rooms?.[0]?.name).toBe("after-rename");

    unmount();
    unregister();
  });

  it("shares one Ably control-channel refresh and failure state across three mounted surfaces on a phone", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const roomUnread = makeRoom({ id: "room-a", unreadCount: 2 });

    fetchMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ rooms: [roomUnread], nextCursor: null });

    const seen: Record<string, { rooms: ChatRoom[] | null; failed: boolean }> =
      {};
    function Surface({ id }: { id: string }) {
      seen[id] = useLiveChatRoomsRead();
      return null;
    }

    const view = render(
      <>
        <ChatControlListBridge currentUserId="user-1" />
        <Surface id="tab-dot" />
        <Surface id="threads" />
        <Surface id="decisions" />
      </>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // D4: all three surfaces see the failed first read, with only one GET sent.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen["tab-dot"]).toEqual({ rooms: null, failed: true });
    expect(seen.threads).toEqual({ rooms: null, failed: true });
    expect(seen.decisions).toEqual({ rooms: null, failed: true });

    // Realtime Ably control event triggers one active GET; all three share one array.
    fetchMock.mockClear();
    await act(async () => {
      const handler = controlSubscribe.mock.calls.find(
        ([name]) => name === "chat_rooms_changed",
      )?.[1];
      expect(handler).toBeTypeOf("function");
      handler({
        data: {
          collections: ["active"],
          roomId: "room-a",
          at: "2026-09-10T12:00:00.000Z",
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    expect(seen["tab-dot"]?.failed).toBe(false);
    expect(seen["tab-dot"]?.rooms?.map((r) => r.id)).toEqual(["room-a"]);
    expect(seen.threads?.rooms).toBe(seen["tab-dot"]?.rooms);
    expect(seen.decisions?.rooms).toBe(seen["tab-dot"]?.rooms);

    view.unmount();
  });
});
