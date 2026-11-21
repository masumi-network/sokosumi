import type { ChatRoom } from "@sokosumi/core-client";
import { act, render, renderHook } from "@testing-library/react";
import { useEffect, useState } from "react";
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
import * as chatRefreshScheduler from "./use-chat-refresh-scheduler";
import { useLiveChatRooms, useLiveChatRoomsRead } from "./use-live-chat-rooms";

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

  it("never returns another workspace's held rows, before or while its own read is pending", async () => {
    vi.stubGlobal("innerWidth", 390);
    const other = { id: "room-x", name: "secret-plans", kind: "channel" };
    publishMembershipVisibleRooms([other as never], "org-2", "user-1");
    let resolveRead: (page: { rooms: unknown[] }) => void = () => {};
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const seen: unknown[] = [];
    function Probe() {
      seen.push(useLiveChatRooms());
      return null;
    }
    const view = render(<Probe />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.every((rooms) => rooms === null)).toBe(true);

    const own = { id: "room-1", name: "general", kind: "channel" };
    await act(async () => {
      resolveRead({ rooms: [own] });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen.at(-1)).toEqual([expect.objectContaining({ id: "room-1" })]);
    view.unmount();
  });

  it("returns held rows at once when they are this workspace's", () => {
    vi.stubGlobal("innerWidth", 390);
    const own = { id: "room-1", name: "general", kind: "channel" };
    publishMembershipVisibleRooms([own as never], "org-1", "user-1");
    fetchMock.mockReturnValue(new Promise(() => {}));
    let first: unknown;
    function Probe() {
      const rooms = useLiveChatRooms();
      if (first === undefined) first = rooms;
      return null;
    }
    render(<Probe />).unmount();
    expect(first).toEqual([expect.objectContaining({ id: "room-1" })]);
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

    unmount();
    unregister();
  });
  describe("when the workspace changes while a room read is in flight", () => {
    // The old read can answer after the new workspace's layout commit and
    // before the old scheduler's passive cleanup marks the read stale. Keep
    // the old read current at the scheduler boundary so act can flush the
    // workspace change without closing that window.
    async function switchWhileReading(answer: { rooms: unknown[] } | null) {
      vi.useRealTimers();
      vi.stubGlobal("innerWidth", 390);
      const oldRead = Promise.withResolvers<typeof answer>();
      fetchMock
        .mockReturnValueOnce(oldRead.promise)
        .mockReturnValue(new Promise(() => {}));
      const useScheduler = chatRefreshScheduler.useChatRefreshScheduler;
      let firstRead = true;
      const scheduler = vi
        .spyOn(chatRefreshScheduler, "useChatRefreshScheduler")
        .mockImplementation((options) =>
          useScheduler({
            ...options,
            refresh: (isCurrent) => {
              const isOldRead = firstRead;
              firstRead = false;
              return options.refresh(() => isOldRead || isCurrent());
            },
          }),
        );
      try {
        const view = await act(async () => renderHook(useLiveChatRoomsRead));
        const { result, rerender } = view;
        expect(fetchMock).toHaveBeenCalledTimes(1);

        sessionState.organizationId = "org-2";
        await act(async () => rerender());
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(result.current).toEqual({ rooms: null, failed: false });

        await act(async () => oldRead.resolve(answer));
        return view;
      } finally {
        scheduler.mockRestore();
      }
    }

    it("never shows the old workspace's rows", async () => {
      const { result, unmount } = await switchWhileReading({
        rooms: [{ id: "room-a", name: "org-1-only", kind: "channel" }],
      });
      expect(result.current).toEqual({ rooms: null, failed: false });
      unmount();
    });

    it("never marks the new workspace failed for the old read", async () => {
      const { result, rerender, unmount } = await switchWhileReading(null);
      expect(result.current).toEqual({ rooms: null, failed: false });

      // A late failure stored under the old scope is visible on return,
      // while the fresh read for that scope is still pending.
      sessionState.organizationId = "org-1";
      await act(async () => rerender());
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(result.current).toEqual({ rooms: null, failed: false });
      unmount();
    });
  });
});
