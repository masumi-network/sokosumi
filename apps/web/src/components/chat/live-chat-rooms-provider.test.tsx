import type { ChatRoom } from "@sokosumi/core-client";
import { act, render } from "@testing-library/react";
import { Activity, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, sessionState } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  sessionState: {
    userId: "user-1",
    organizationId: "org-1" as string | null,
  },
}));

vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: sessionState.userId },
      session: { activeOrganizationId: sessionState.organizationId },
    },
  }),
}));
vi.mock("@/lib/ably/ably-connection-health-store", () => ({
  useAblyConnectionHealthy: () => true,
}));

import { clearMembershipVisibleRoomsSnapshot } from "./membership-visible-rooms-store";
import { notifyOrganizationChatRoomsChanged } from "./organization-chat-events";
import { clearRoomReadOverlays } from "./room-read-overlay";
import {
  LiveChatRoomsProvider,
  useLiveChatRooms,
  useLiveChatRoomsRead,
} from "./use-live-chat-rooms";

function room(id: string, unreadCount = 0): ChatRoom {
  return {
    id,
    name: id,
    kind: "channel",
    unreadCount,
    unreadMentionCount: 0,
    markedUnread: false,
    mutedAt: null,
    updatedAt: new Date("2026-11-24T10:00:00Z"),
  } as ChatRoom;
}

describe("LiveChatRoomsProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal("innerWidth", 390);
    fetchMock.mockReset();
    sessionState.userId = "user-1";
    sessionState.organizationId = "org-1";
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
  });

  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("runs one mount read and one 60 s timer read for three callers, and serves a fourth caller immediately with no read (D1, D2)", async () => {
    const initialRows = [room("room-1", 1)];
    const refreshedRows = [room("room-1", 1), room("room-2", 2)];
    fetchMock
      .mockResolvedValueOnce({ rooms: initialRows })
      .mockResolvedValueOnce({ rooms: refreshedRows });

    const seen: Record<string, (ChatRoom[] | null)[]> = {
      first: [],
      second: [],
      third: [],
      fourth: [],
    };
    let mountFourth: () => void = () => {};

    function Caller({
      name,
      useRead = false,
    }: {
      name: keyof typeof seen;
      useRead?: boolean;
    }) {
      const rooms = useRead ? useLiveChatRoomsRead().rooms : useLiveChatRooms();
      seen[name].push(rooms);
      return null;
    }

    function App() {
      const [showFourth, setShowFourth] = useState(false);
      mountFourth = () => setShowFourth(true);
      return (
        <LiveChatRoomsProvider>
          <Caller name="first" />
          <Caller name="second" />
          <Caller name="third" useRead />
          {showFourth ? <Caller name="fourth" useRead /> : null}
        </LiveChatRoomsProvider>
      );
    }

    const view = render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // D1: mount read runs once for three callers.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    expect(seen.first.at(-1)?.map((r) => r.id)).toEqual(["room-1"]);
    expect(seen.second.at(-1)?.map((r) => r.id)).toEqual(["room-1"]);
    expect(seen.third.at(-1)?.map((r) => r.id)).toEqual(["room-1"]);

    // D1: 60 s healthy timer runs once for three callers.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen.first.at(-1)?.map((r) => r.id)).toEqual(["room-1", "room-2"]);
    expect(seen.second.at(-1)?.map((r) => r.id)).toEqual(["room-1", "room-2"]);
    expect(seen.third.at(-1)?.map((r) => r.id)).toEqual(["room-1", "room-2"]);

    // D2: a fourth caller mounting later gets the rows at once with no read.
    await act(async () => {
      mountFourth();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen.fourth[0]?.map((r) => r.id)).toEqual(["room-1", "room-2"]);

    view.unmount();
  });

  it("keeps reading when a caller is hidden in Activity and causes no extra read on reveal (D3)", async () => {
    const initialRows = [room("room-1", 1)];
    const whileHiddenRows = [room("room-1", 1), room("room-2", 0)];
    fetchMock
      .mockResolvedValueOnce({ rooms: initialRows })
      .mockResolvedValueOnce({ rooms: whileHiddenRows });

    const seen: (ChatRoom[] | null)[] = [];
    let setMode: (mode: "visible" | "hidden") => void = () => {};

    function Caller() {
      seen.push(useLiveChatRooms());
      return null;
    }

    function App() {
      const [mode, updateMode] = useState<"visible" | "hidden">("visible");
      setMode = updateMode;
      return (
        <LiveChatRoomsProvider>
          <Activity mode={mode}>
            <Caller />
          </Activity>
        </LiveChatRoomsProvider>
      );
    }

    const view = render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)?.map((r) => r.id)).toEqual(["room-1"]);

    // Hide the caller in Activity: provider's reader stays alive.
    await act(async () => {
      setMode("hidden");
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Reveal the caller: no extra read, rows reflect the latest read.
    await act(async () => {
      setMode("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(seen.at(-1)?.map((r) => r.id)).toEqual(["room-1", "room-2"]);

    view.unmount();
  });

  it("issues exactly one active collection request for one message with three callers on a phone (interleaving 16)", async () => {
    fetchMock
      .mockResolvedValueOnce({ rooms: [room("room-1", 0)] })
      .mockResolvedValueOnce({ rooms: [room("room-1", 1)] });

    const seen: Record<string, (ChatRoom[] | null)[]> = {
      first: [],
      second: [],
      third: [],
    };

    function Caller({ name }: { name: keyof typeof seen }) {
      seen[name].push(useLiveChatRooms());
      return null;
    }

    const view = render(
      <LiveChatRoomsProvider>
        <Caller name="first" />
        <Caller name="second" />
        <Caller name="third" />
      </LiveChatRoomsProvider>,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();

    await act(async () => {
      notifyOrganizationChatRoomsChanged({
        collections: ["active"],
        roomId: "room-1",
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("active");
    expect(seen.first.at(-1)?.[0]?.unreadCount).toBe(1);
    expect(seen.second.at(-1)?.[0]?.unreadCount).toBe(1);
    expect(seen.third.at(-1)?.[0]?.unreadCount).toBe(1);

    view.unmount();
  });
});
