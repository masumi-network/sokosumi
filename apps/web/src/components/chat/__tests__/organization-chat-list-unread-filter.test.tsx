import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createOrganizationChatList,
  emptyListResult,
  harnessPathname,
  listRoomsMock,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const unreadChannel = makeRoom({
  id: "launch",
  name: "launch",
  kind: "channel",
  myAccess: "member",
  unreadCount: 2,
  channelUnreadCount: 2,
});
const threadsOnlyChannel = makeRoom({
  id: "design",
  name: "design",
  kind: "channel",
  myAccess: "member",
  unreadCount: 1,
  channelUnreadCount: 0,
  threadUnreadCount: 1,
  unreadThreadCount: 1,
});
const readChannel = makeRoom({
  id: "general",
  name: "general",
  kind: "channel",
  myAccess: "member",
  channelUnreadCount: 0,
});
const readDirect = makeRoom({
  id: "dm",
  kind: "direct",
  myAccess: "member",
  channelUnreadCount: 0,
});
const rooms = [unreadChannel, threadsOnlyChannel, readChannel, readDirect];

function rowLabels() {
  return screen
    .queryAllByTestId("room-row")
    .map((row) => within(row).getAllByText(/./)[0]?.textContent);
}

// All unreads is a filter on the sidebar's own sections (SOK-1159), not a
// page: the same sections, holding only the rooms a read would still change.
describe("OrganizationChatList All unreads filter", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
  });

  it("keeps only rooms with unread, Thread unread included, and drops empty sections", async () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    expect(rowLabels()).toEqual(["design", "general", "launch", "room"]);

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(rowLabels()).toEqual(["design", "launch"]);
    expect(screen.getByText("App.Channels.title")).toBeInTheDocument();
    expect(
      screen.queryByText("App.Channels.directMessages"),
    ).not.toBeInTheDocument();
  });

  it("says the reader is caught up when nothing is left, with the way back", async () => {
    listRoomsMock.mockResolvedValue(emptyListResult([readChannel, readDirect]));
    renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [readChannel, readDirect],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(rowLabels()).toEqual([]);
    expect(
      screen.getByText("App.Channels.UnreadNav.caughtUp"),
    ).toBeInTheDocument();

    // The way back is on the empty state itself.
    await userEvent.click(
      screen.getByRole("button", {
        name: "App.Channels.UnreadNav.showAllChats",
      }),
    );

    expect(rowLabels()).toEqual(["general", "room"]);
    expect(screen.getByRole("button", { name: "All unreads" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  // The open room stays listed so reading it never pulls it away, but it is
  // there because it is open, not because it holds anything unread.
  it("says caught up with only the open room left, and keeps that room", async () => {
    harnessPathname.current = `/chat/rooms/${readChannel.id}`;
    listRoomsMock.mockResolvedValue(emptyListResult([readChannel, readDirect]));
    renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [readChannel, readDirect],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(rowLabels()).toEqual(["general"]);
    expect(
      screen.getByText("App.Channels.UnreadNav.caughtUp"),
    ).toBeInTheDocument();
  });

  it("puts every room back when turned off", async () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    const toggle = screen.getByRole("button", { name: "All unreads" });

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(rowLabels()).toEqual(["design", "general", "launch", "room"]);
  });
});

// Rooms read while the filter is on move to Just read instead of vanishing,
// newest first, until the filter is switched off (SOK-1159).
describe("OrganizationChatList All unreads Just read", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  function justReadLabels(container: HTMLElement) {
    const section = container.querySelector('[data-slot="just-read"]');
    return section
      ? within(section as HTMLElement)
          .queryAllByTestId("room-row")
          .map((row) => within(row).getAllByText(/./)[0]?.textContent)
      : [];
  }

  it("moves each room read during the pass down, newest first, and forgets them when off", async () => {
    // A read moves the room's `updatedAt` on; the read overlay holds a room's
    // last attention until it does.
    let clock = Date.parse("2026-09-23T10:00:00.000Z");
    const read = (room: typeof unreadChannel) => ({
      ...room,
      updatedAt: new Date((clock += 60_000)),
      unreadCount: 0,
      channelUnreadCount: 0,
      threadUnreadCount: 0,
      unreadThreadCount: 0,
    });
    const start = [unreadChannel, threadsOnlyChannel, readChannel];
    listRoomsMock.mockResolvedValue(emptyListResult(start));
    const { container, rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: start,
    });
    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));
    expect(justReadLabels(container)).toEqual([]);

    // #launch is read.
    const launchRead = [read(unreadChannel), threadsOnlyChannel, readChannel];
    listRoomsMock.mockResolvedValue(emptyListResult(launchRead));
    rerender(
      createOrganizationChatList({
        organizationId: "org-1",
        rooms: launchRead,
      }),
    );
    expect(justReadLabels(container)).toEqual(["launch"]);

    // #design too: caught up, both one click away, newest first.
    const allRead = [
      read(unreadChannel),
      read(threadsOnlyChannel),
      readChannel,
    ];
    listRoomsMock.mockResolvedValue(emptyListResult(allRead));
    rerender(
      createOrganizationChatList({ organizationId: "org-1", rooms: allRead }),
    );
    expect(justReadLabels(container)).toEqual(["design", "launch"]);
    expect(
      screen.getByText("App.Channels.UnreadNav.caughtUp"),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));
    expect(justReadLabels(container)).toEqual([]);
  });
});
