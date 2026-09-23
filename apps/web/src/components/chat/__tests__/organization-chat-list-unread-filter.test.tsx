import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createOrganizationChatList,
  emptyListResult,
  harnessPathname,
  listPendingMock,
  listRoomsMock,
  makeInvitation,
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

/** The filter's rows, and which of them are read in the pass: dimmed. */
function inboxRows(container: HTMLElement) {
  const inbox = container.querySelector('[data-slot="unread-inbox"]');
  return inbox
    ? within(inbox as HTMLElement)
        .queryAllByTestId("room-row")
        .map((row) => {
          const label = within(row).getAllByText(/./)[0]?.textContent;
          return row.closest('[data-read="true"]') ? `${label} (read)` : label;
        })
    : [];
}

// A read moves the room's `updatedAt` on; the read overlay holds a room's
// last attention until it does.
let clock = Date.parse("2026-09-23T10:00:00.000Z");
function read(room: typeof unreadChannel) {
  return {
    ...room,
    updatedAt: new Date((clock += 60_000)),
    unreadCount: 0,
    channelUnreadCount: 0,
    threadUnreadCount: 0,
    unreadThreadCount: 0,
  };
}

// All unreads is a filter on the sidebar (SOK-1159), not a page: one flat
// list of the rooms a read would still change, with no section headings.
describe("OrganizationChatList All unreads filter", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
  });

  it("lists only rooms with unread, Thread unread included, in one list without sections", async () => {
    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms,
    });
    expect(rowLabels()).toEqual(["design", "general", "launch", "room"]);

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(inboxRows(container).sort()).toEqual(["design", "launch"]);
    expect(rowLabels().sort()).toEqual(["design", "launch"]);
    expect(screen.queryByText("App.Channels.title")).not.toBeInTheDocument();
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
    expect(screen.getByRole("status")).toHaveTextContent(
      "App.Channels.UnreadNav.caughtUp",
    );
    expect(
      screen.queryByText("App.Channels.UnreadNav.justRead"),
    ).not.toBeInTheDocument();
  });

  // The open room stays listed so reading it never pulls it away, but it is
  // there because it is open, not because it holds anything unread.
  it("says caught up with only the open room left, and lists that room as read", async () => {
    harnessPathname.current = `/chat/rooms/${readChannel.id}`;
    listRoomsMock.mockResolvedValue(emptyListResult([readChannel, readDirect]));
    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [readChannel, readDirect],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(inboxRows(container)).toEqual(["general (read)"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "App.Channels.UnreadNav.caughtUp",
    );
    expect(
      screen.getByText("App.Channels.UnreadNav.justRead"),
    ).toBeInTheDocument();
  });

  it("keeps a pending invitation under the filter, and is not caught up", async () => {
    const invitation = makeInvitation();
    listPendingMock.mockResolvedValue({ ok: true, value: [invitation] });
    listRoomsMock.mockResolvedValue(emptyListResult([readChannel]));
    renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [readChannel],
      pendingInvitations: [invitation],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(
      await screen.findByText("App.Channels.External.title"),
    ).toBeInTheDocument();
    expect(screen.getByText("Partners")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("puts every room back when turned off", async () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    const toggle = screen.getByRole("button", { name: "All unreads" });

    await userEvent.click(toggle);
    await userEvent.click(toggle);

    expect(rowLabels()).toEqual(["design", "general", "launch", "room"]);
  });
});

// Rooms read while the filter is on stay where they are, dimmed, until the
// filter is switched off (SOK-1159).
describe("OrganizationChatList All unreads read in place", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  it("dims each room read during the pass in its place, and forgets them when off", async () => {
    const start = [unreadChannel, threadsOnlyChannel, readChannel];
    listRoomsMock.mockResolvedValue(emptyListResult(start));
    const { container, rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: start,
    });
    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));
    const order = inboxRows(container);
    expect(order.sort()).toEqual(["design", "launch"]);
    const [first, second] = inboxRows(container);

    // #launch is read: it stays in its place, dimmed.
    const launchRead = [read(unreadChannel), threadsOnlyChannel, readChannel];
    listRoomsMock.mockResolvedValue(emptyListResult(launchRead));
    rerender(
      createOrganizationChatList({
        organizationId: "org-1",
        rooms: launchRead,
      }),
    );
    const dim = (label?: string) =>
      label === "launch" ? "launch (read)" : label;
    expect(inboxRows(container)).toEqual([dim(first), dim(second)]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // #design too: caught up, both still one click away, still in place.
    const allRead = [
      read(unreadChannel),
      read(threadsOnlyChannel),
      readChannel,
    ];
    listRoomsMock.mockResolvedValue(emptyListResult(allRead));
    rerender(
      createOrganizationChatList({ organizationId: "org-1", rooms: allRead }),
    );
    expect(inboxRows(container)).toEqual([
      `${first} (read)`,
      `${second} (read)`,
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "App.Channels.UnreadNav.caughtUp",
    );

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));
    expect(inboxRows(container)).toEqual([]);
  });
});
