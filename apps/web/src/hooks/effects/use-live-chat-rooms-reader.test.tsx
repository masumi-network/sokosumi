import type { ChatRoom } from "@sokosumi/core-client";
import { act, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
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
  SIDEBAR_REGISTRATION_WAIT_MS,
} from "@/components/chat/membership-visible-rooms-store";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";
import { useLiveChatRoomsRead } from "@/components/chat/use-live-chat-rooms";
import { setAblyConnectionHealthy } from "@/lib/ably/ably-connection-health-store";
import { useLiveChatRoomsReader } from "./use-live-chat-rooms-reader";
import { MOBILE_BREAKPOINT } from "./use-mobile";

function ReaderProbe({
  organizationId = "org-1",
  currentUserId = "user-1",
  healthy = true,
}: {
  organizationId?: string | null;
  currentUserId?: string;
  healthy?: boolean;
}) {
  useLiveChatRoomsReader(organizationId, currentUserId, healthy);
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

  it("switches workspace scope on desktop without restarting the 2 s wait", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT + 200);
    const { rerender, unmount } = render(
      <ReaderProbe organizationId="org-1" />,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIDEBAR_REGISTRATION_WAIT_MS);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    rerender(<ReaderProbe organizationId="org-2" />);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unmount();
  });

  it("updates Ably health without triggering a read on drop and runs one recovery read on reconnect", async () => {
    vi.stubGlobal("innerWidth", MOBILE_BREAKPOINT - 1);
    const { rerender, unmount } = render(<ReaderProbe healthy />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockClear();
    rerender(<ReaderProbe healthy={false} />);
    expect(fetchMock).not.toHaveBeenCalled();

    rerender(<ReaderProbe healthy />);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    unmount();
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
