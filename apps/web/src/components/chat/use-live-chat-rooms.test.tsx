import { act, render } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@/components/chat/fetch-sidebar-room-collection", () => ({
  fetchSidebarRoomCollection: fetchMock,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org-1" },
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
    vi.stubGlobal("innerWidth", 1280);
  });
  afterEach(() => {
    clearMembershipVisibleRoomsSnapshot();
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
});
