import type { ChatRoom } from "@sokosumi/core-client";
import { act, render, renderHook } from "@testing-library/react";
import { Activity, useEffect, useState } from "react";
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

import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
  registerMembershipVisibleRoomsPublisher,
} from "./membership-visible-rooms-store";
import { clearRoomReadOverlays, rememberRoomRead } from "./room-read-overlay";
import { useLiveChatRooms } from "./use-live-chat-rooms";

function TabUnread() {
  useLiveChatRooms();
  return null;
}

/** Stands in for the sidebar list, which registers from an effect. */
function SidebarList() {
  useEffect(() => registerMembershipVisibleRoomsPublisher(), []);
  return null;
}

describe("useLiveChatRooms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ rooms: [] });
    sessionState.userId = "user-1";
    sessionState.organizationId = "org-1";
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    vi.stubGlobal("innerWidth", 1280);
  });
  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
    clearRoomReadOverlays();
    vi.useRealTimers();
  });

  it("leaves the read to a desktop sidebar that mounts a moment later", async () => {
    function Page() {
      const [sidebar, setSidebar] = useState(false);
      useEffect(() => {
        const timer = setTimeout(() => setSidebar(true), 300);
        return () => clearTimeout(timer);
      }, []);
      return (
        <>
          <TabUnread />
          {sidebar ? <SidebarList /> : null}
        </>
      );
    }
    const view = render(<Page />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("reads the rooms itself on desktop when no sidebar comes", async () => {
    const view = render(<TabUnread />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledWith("active");
    view.unmount();
  });

  it("pauses desktop ownership wait while hidden in Activity and settles on return", async () => {
    const view = render(
      <Activity mode="visible">
        <TabUnread />
      </Activity>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(
      <Activity mode="hidden">
        <TabUnread />
      </Activity>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    view.rerender(
      <Activity mode="visible">
        <TabUnread />
      </Activity>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("active");
    view.unmount();
  });

  it("reads at once on a phone", async () => {
    vi.stubGlobal("innerWidth", 390);
    const view = render(<TabUnread />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("active");
    view.unmount();
  });

  it("mirrors sidebar snapshots, keeps them after the sidebar unmounts, and drops them on workspace switch", () => {
    const unregister = registerMembershipVisibleRoomsPublisher();
    const roomA = { id: "room-a" } as ChatRoom;
    const roomB = { id: "room-b" } as ChatRoom;

    const { result, rerender, unmount } = renderHook(() => useLiveChatRooms());

    act(() => {
      publishMembershipVisibleRooms([roomA], "org-1", "user-1");
    });
    expect(result.current?.map((r) => r.id)).toEqual(["room-a"]);

    act(() => {
      publishMembershipVisibleRooms([roomA, roomB], "org-1", "user-1");
    });
    expect(result.current?.map((r) => r.id)).toEqual(["room-a", "room-b"]);

    act(() => {
      unregister();
    });
    expect(result.current?.map((r) => r.id)).toEqual(["room-a", "room-b"]);

    sessionState.organizationId = "org-2";
    rerender();
    expect(result.current).toBeNull();
    unmount();
  });

  it("keeps a newer local Mark Read overlay on workspace switch into a matching live snapshot", () => {
    const unregister = registerMembershipVisibleRoomsPublisher();
    const roomA = {
      id: "room-a",
      unreadCount: 1,
      unreadMentionCount: 0,
      markedUnread: false,
      updatedAt: new Date("2026-11-20T10:00:00Z"),
    } as ChatRoom;
    const staleRoomB = {
      id: "room-b",
      unreadCount: 3,
      unreadMentionCount: 1,
      markedUnread: false,
      updatedAt: new Date("2026-11-20T11:00:00Z"),
    } as ChatRoom;

    const { result, rerender, unmount } = renderHook(() => useLiveChatRooms());

    act(() => {
      publishMembershipVisibleRooms([roomA], "org-1", "user-1");
    });
    expect(result.current?.map((r) => r.id)).toEqual(["room-a"]);

    // Newer local Mark Read overlay for room-b before switching into org-2.
    rememberRoomRead({
      ...staleRoomB,
      unreadCount: 0,
      unreadMentionCount: 0,
      markedUnread: false,
      updatedAt: new Date("2026-11-20T12:00:00Z"),
    });

    // Live sidebar snapshot already holds stale unread counts for org-2.
    act(() => {
      publishMembershipVisibleRooms([staleRoomB], "org-2", "user-1");
    });

    sessionState.organizationId = "org-2";
    rerender();

    expect(result.current).toHaveLength(1);
    expect(result.current?.[0]?.id).toBe("room-b");
    expect(result.current?.[0]?.unreadCount).toBe(0);
    expect(result.current?.[0]?.unreadMentionCount).toBe(0);

    unregister();
    unmount();
  });
});
