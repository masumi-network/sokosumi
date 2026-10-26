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

import { registerMembershipVisibleRoomsPublisher } from "./membership-visible-rooms-store";
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
    window.innerWidth = 1280;
  });
  afterEach(() => vi.useRealTimers());

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
    window.innerWidth = 390;
    const view = render(<TabUnread />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(fetchMock).toHaveBeenCalledWith("active");
    view.unmount();
  });
});
