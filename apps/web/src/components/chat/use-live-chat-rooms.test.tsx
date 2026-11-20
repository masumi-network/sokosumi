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
    vi.stubGlobal("innerWidth", 1280);
  });
  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
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
});
