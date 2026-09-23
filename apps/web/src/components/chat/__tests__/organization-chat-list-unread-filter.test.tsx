import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
  parseChatUnreadsFilterCookieHeader,
  serializeChatUnreadsFilterCookie,
} from "@/lib/ui-preferences/chat-unreads-filter";

import {
  createOrganizationChatList,
  emptyListResult,
  harnessPathname,
  harnessSelection,
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
  // Newer than #design, so the filter's order is activity, not id.
  updatedAt: new Date("2026-09-23T09:00:00.000Z"),
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
    expect(rowLabels()).toEqual(["launch", "design", "general", "room"]);

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(inboxRows(container)).toEqual(["launch", "design"]);
    expect(screen.queryByText("App.Channels.title")).not.toBeInTheDocument();
    expect(
      screen.queryByText("App.Channels.directMessages"),
    ).not.toBeInTheDocument();
  });

  it("says the reader is caught up when nothing is left", async () => {
    listRoomsMock.mockResolvedValue(emptyListResult([readChannel, readDirect]));
    const { container } = renderOrganizationChatList({
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
    // The empty list stays mounted for the pass, and must not name the
    // label that is not there.
    expect(
      container.querySelector('[data-slot="unread-inbox"]'),
    ).not.toHaveAttribute("aria-labelledby");
  });

  // The open room stays listed so reading it never pulls it away, but it is
  // there because it is open, not because it holds anything unread.
  it("says caught up with only the open room left, and lists that room undimmed while open", async () => {
    harnessPathname.current = `/chat/rooms/${readChannel.id}`;
    listRoomsMock.mockResolvedValue(emptyListResult([readChannel, readDirect]));
    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [readChannel, readDirect],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    // Dimmed, its highlight would read as disabled.
    expect(inboxRows(container)).toEqual(["general"]);
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

    expect(rowLabels()).toEqual(["launch", "design", "general", "room"]);
  });
});

// The reader's choice is remembered per browser, so a reload opens where they
// left off.
describe("OrganizationChatList remembered Unreads filter", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
  });

  it("opens on the filter when the reader left it on", () => {
    document.cookie = serializeChatUnreadsFilterCookie(true);

    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms,
    });

    expect(screen.getByRole("button", { name: "All unreads" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(inboxRows(container)).toEqual(["launch", "design"]);
  });

  // The boot mark only covers the prerendered All list until React reads the
  // cookie; left behind, it would hide All if the filter later goes off.
  it("drops the page's boot mark once the list shows the remembered filter", () => {
    document.cookie = serializeChatUnreadsFilterCookie(true);
    document.documentElement.setAttribute(
      CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE,
      "",
    );

    renderOrganizationChatList({ organizationId: "org-1", rooms });

    expect(
      document.documentElement.hasAttribute(CHAT_UNREADS_FILTER_BOOT_ATTRIBUTE),
    ).toBe(false);
  });

  it("remembers the reader switching it on and off", async () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    const toggle = screen.getByRole("button", { name: "All unreads" });

    await userEvent.click(toggle);
    expect(parseChatUnreadsFilterCookieHeader(document.cookie)).toBe(true);

    await userEvent.click(toggle);
    expect(parseChatUnreadsFilterCookieHeader(document.cookie)).toBe(false);
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
    expect(inboxRows(container)).toEqual(["launch", "design"]);

    // #launch is read: it stays in its place, dimmed.
    const launchRead = [read(unreadChannel), threadsOnlyChannel, readChannel];
    listRoomsMock.mockResolvedValue(emptyListResult(launchRead));
    rerender(
      createOrganizationChatList({
        organizationId: "org-1",
        rooms: launchRead,
      }),
    );
    // Its read moved `updatedAt` on, and it still does not jump.
    expect(inboxRows(container)).toEqual(["launch (read)", "design"]);
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
    expect(inboxRows(container)).toEqual(["launch (read)", "design (read)"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "App.Channels.UnreadNav.caughtUp",
    );

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));
    expect(inboxRows(container)).toEqual([]);
  });
});

// Pinned rooms stay one click away under the filter (SOK-1159), so reaching
// one never means switching it off. Pinned is fixed: every pinned room, in
// the reader's order, and only there.
describe("OrganizationChatList All unreads pinned rooms", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  function pinnedRows(container: HTMLElement) {
    const group = container.querySelector('[data-slot="unread-inbox-pinned"]');
    return group
      ? within(group as HTMLElement)
          .queryAllByTestId("room-row")
          .map((row) => {
            const label = within(row).getAllByText(/./)[0]?.textContent;
            return row.closest('[data-read="true"]')
              ? `${label} (read)`
              : label;
          })
      : [];
  }

  const pinnedRead = makeRoom({
    ...readChannel,
    id: "handbook",
    name: "handbook",
    starredAt: new Date("2026-09-01T00:00:00.000Z"),
  });
  const pinnedUnread = makeRoom({
    ...unreadChannel,
    id: "ops",
    name: "ops",
    starredAt: new Date("2026-09-02T00:00:00.000Z"),
  });

  it("lists every pinned room under Pinned only, unread ones undimmed, below the flat list", async () => {
    const start = [unreadChannel, pinnedRead, pinnedUnread, readChannel];
    listRoomsMock.mockResolvedValue(emptyListResult(start));
    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: start,
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(inboxRows(container)).toEqual(["launch"]);
    expect(pinnedRows(container)).toEqual(["handbook (read)", "ops"]);
    const pinnedGroup = container.querySelector(
      '[data-slot="unread-inbox-pinned"]',
    );
    const inbox = container.querySelector('[data-slot="unread-inbox"]');
    expect(inbox?.compareDocumentPosition(pinnedGroup as Node) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(screen.getByRole("list", { name: "App.Channels.pinned" })).toBe(
      container.querySelector('[data-slot="unread-inbox-pinned"]'),
    );
  });

  it("moves a room out of the flat list when it is pinned during the pass", async () => {
    const start = [unreadChannel, readChannel];
    listRoomsMock.mockResolvedValue(emptyListResult(start));
    const { container, rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: start,
    });
    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));
    expect(inboxRows(container)).toEqual(["launch"]);
    expect(pinnedRows(container)).toEqual([]);

    const launchPinned = [
      makeRoom({
        ...unreadChannel,
        starredAt: new Date("2026-09-02T00:00:00.000Z"),
      }),
      readChannel,
    ];
    listRoomsMock.mockResolvedValue(emptyListResult(launchPinned));
    rerender(
      createOrganizationChatList({
        organizationId: "org-1",
        rooms: launchPinned,
      }),
    );

    expect(pinnedRows(container)).toEqual(["launch"]);
    expect(inboxRows(container)).toEqual([]);
    expect(rowLabels()).toEqual(["launch"]);

    // Unpin puts it back in the flat list, in the place the pass kept.
    rerender(
      createOrganizationChatList({
        organizationId: "org-1",
        rooms: start,
      }),
    );
    expect(pinnedRows(container)).toEqual([]);
    expect(inboxRows(container)).toEqual(["launch"]);
  });

  it("keeps a pinned room opened from the filter in Pinned, where it was", async () => {
    const start = [unreadChannel, pinnedRead, pinnedUnread];
    listRoomsMock.mockResolvedValue(emptyListResult(start));
    const { container, rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: start,
    });
    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    // Opened after the filter was on, the way a click from Pinned does it.
    harnessPathname.current = `/chat/rooms/${pinnedRead.id}`;
    rerender(
      createOrganizationChatList({ organizationId: "org-1", rooms: start }),
    );

    expect(pinnedRows(container)).toEqual(["handbook", "ops"]);
    expect(inboxRows(container)).toEqual(["launch"]);

    // Left for another room, it dims where it is.
    harnessPathname.current = `/chat/rooms/${unreadChannel.id}`;
    rerender(
      createOrganizationChatList({ organizationId: "org-1", rooms: start }),
    );
    expect(pinnedRows(container)).toEqual(["handbook (read)", "ops"]);
  });

  it("dims from the highlight, before the route catches up", async () => {
    const start = [unreadChannel, pinnedRead];
    listRoomsMock.mockResolvedValue(emptyListResult(start));
    // The route still names #launch. The highlight has already moved to the
    // read pin, query and all, the way a click does before pathname commits.
    harnessPathname.current = `/chat/rooms/${unreadChannel.id}`;
    harnessSelection.current = `/chat/rooms/${pinnedRead.id}?message=m-1`;
    const { container, rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: start,
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(pinnedRows(container)).toEqual(["handbook"]);

    // Left again. The route has not moved; the highlight has.
    harnessSelection.current = `/chat/rooms/${unreadChannel.id}`;
    rerender(
      createOrganizationChatList({ organizationId: "org-1", rooms: start }),
    );
    expect(pinnedRows(container)).toEqual(["handbook (read)"]);
  });

  /** Whether each node comes after the one before it in the document. */
  function inDocumentOrder(...nodes: Array<Node | null>) {
    return nodes
      .slice(1)
      .every(
        (node, index) =>
          node !== null &&
          nodes[index] !== null &&
          (nodes[index] as Node).compareDocumentPosition(node) ===
            Node.DOCUMENT_POSITION_FOLLOWING,
      );
  }

  it("orders the flat list, then a pending invitation, then Pinned", async () => {
    const invitation = makeInvitation();
    listPendingMock.mockResolvedValue({ ok: true, value: [invitation] });
    listRoomsMock.mockResolvedValue(
      emptyListResult([unreadChannel, pinnedRead]),
    );
    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [unreadChannel, pinnedRead],
      pendingInvitations: [invitation],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    const external = await screen.findByText("Partners");
    expect(
      inDocumentOrder(
        container.querySelector('[data-slot="unread-inbox"]'),
        external,
        container.querySelector('[data-slot="unread-inbox-pinned"]'),
      ),
    ).toBe(true);
  });

  it("orders caught up, then Read just now, then Pinned", async () => {
    const start = [unreadChannel, pinnedRead];
    listRoomsMock.mockResolvedValue(emptyListResult(start));
    const { container, rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: start,
    });
    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    const allRead = [read(unreadChannel), pinnedRead];
    listRoomsMock.mockResolvedValue(emptyListResult(allRead));
    rerender(
      createOrganizationChatList({ organizationId: "org-1", rooms: allRead }),
    );

    expect(
      inDocumentOrder(
        screen.getByRole("status"),
        screen.getByText("App.Channels.UnreadNav.justRead"),
        container.querySelector('[data-slot="unread-inbox"]'),
        container.querySelector('[data-slot="unread-inbox-pinned"]'),
      ),
    ).toBe(true);
  });

  it("is not caught up while a pinned room alone is unread", async () => {
    listRoomsMock.mockResolvedValue(
      emptyListResult([pinnedUnread, readChannel]),
    );
    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [pinnedUnread, readChannel],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(pinnedRows(container)).toEqual(["ops"]);
    expect(inboxRows(container)).toEqual([]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("still says caught up with only pinned rooms listed, the message first", async () => {
    listRoomsMock.mockResolvedValue(emptyListResult([pinnedRead, readChannel]));
    const { container } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [pinnedRead, readChannel],
    });

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "App.Channels.UnreadNav.caughtUp",
    );
    expect(pinnedRows(container)).toEqual(["handbook (read)"]);
    expect(rowLabels()).toEqual(["handbook"]);
    expect(
      screen
        .getByRole("status")
        .compareDocumentPosition(
          container.querySelector('[data-slot="unread-inbox-pinned"]') as Node,
        ),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});
