import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  emptyListResult,
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

  it("says the reader is caught up when nothing is left", async () => {
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
  });

  it("puts every room back when turned off", async () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    const toggle = screen.getByRole("button", { name: "All unreads" });

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(rowLabels()).toEqual(["design", "general", "launch", "room"]);
  });
});
