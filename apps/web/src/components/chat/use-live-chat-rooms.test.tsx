import { act, render } from "@testing-library/react";
import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ rooms: [] });
  });

  it("leaves the read to a sidebar that mounts in the same commit", async () => {
    const view = render(
      <>
        <TabUnread />
        <SidebarList />
      </>,
    );
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    view.unmount();
  });

  it("reads the rooms itself when no sidebar is mounted", async () => {
    const view = render(<TabUnread />);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledWith("active");
    view.unmount();
  });
});
