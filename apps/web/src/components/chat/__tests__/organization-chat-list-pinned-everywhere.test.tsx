import type { ChatRoom } from "@sokosumi/core-client";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  notifyOrganizationChatRoomsChanged,
  ORGANIZATION_CHAT_ROOM_READ_EVENT,
} from "@/components/chat/organization-chat-events";
import { clearRoomReadOverlays } from "@/components/chat/room-read-overlay";

import {
  createOrganizationChatList,
  emptyListResult,
  harnessPathname,
  harnessRealCatchUp,
  harnessRowProps,
  listElsewhereMock,
  listRoomsMock,
  makeRoom,
  markAllReadMock,
  renderOrganizationChatList,
  reorderPinnedMock,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

function day(n: number) {
  return new Date(`2026-08-0${n}T00:00:00.000Z`);
}

function myRoom(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return makeRoom({ id, kind: "channel", myAccess: "member", ...overrides });
}

/** A room of another workspace, read unless a test says otherwise. */
function otherRoom(id: string, overrides: Partial<ChatRoom> = {}): ChatRoom {
  return myRoom(id, {
    organizationId: "org-2",
    organizationName: "Other Org",
    ...overrides,
  });
}

function rowNamesIn(element: Element | null) {
  return element
    ? within(element as HTMLElement)
        .queryAllByTestId("room-row")
        .map((row) => row.firstElementChild?.textContent)
    : [];
}

function pinnedRows() {
  let section = screen.getByText("App.Channels.pinned").parentElement;
  while (section && !section.querySelector("ul")) {
    section = section.parentElement;
  }
  return rowNamesIn(section);
}

function pinnedRowsUnderFilter() {
  return rowNamesIn(
    document.querySelector('[data-slot="unread-inbox-pinned"]'),
  );
}

function elsewhereRows() {
  return rowNamesIn(document.querySelector('[data-slot="elsewhere-rows"]'));
}

function rowProps(id: string) {
  return harnessRowProps.get(id) as {
    room: ChatRoom;
    workspaceName?: string;
    canManageSettings?: boolean;
    elsewhere?: boolean;
    onRoomUpdated: (room: ChatRoom) => void;
  };
}

function readRoom(roomId: string) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(ORGANIZATION_CHAT_ROOM_READ_EVENT, {
        detail: { roomId },
      }),
    );
  });
}

async function renderWithPins(
  rooms: ChatRoom[],
  elsewhere: ChatRoom[],
  options: { withChatsHeading?: boolean } = {},
) {
  listRoomsMock.mockResolvedValue(emptyListResult(rooms));
  listElsewhereMock.mockResolvedValue(elsewhere);
  const view = renderOrganizationChatList({ rooms, ...options });
  await waitFor(() => expect(harnessRowProps.has(elsewhere[0].id)).toBe(true));
  return view;
}

beforeEach(() => {
  resetOrganizationChatListMocks();
  clearRoomReadOverlays();
});

describe("Pinned rooms of other workspaces", () => {
  it("lists both sources in Pinned, in the one order", async () => {
    await renderWithPins(
      [
        myRoom("mine-first", { starredAt: day(1) }),
        myRoom("mine-last", { starredAt: day(4) }),
      ],
      [
        otherRoom("theirs-second", { starredAt: day(2) }),
        otherRoom("theirs-third", { starredAt: day(3) }),
      ],
    );

    expect(pinnedRows()).toEqual([
      "mine-first",
      "theirs-second",
      "theirs-third",
      "mine-last",
    ]);
  });

  it("names the workspace on a room of another workspace only", async () => {
    await renderWithPins(
      [
        myRoom("mine", { starredAt: day(1) }),
        myRoom("everywhere", {
          starredAt: day(2),
          discoverability: "external",
        }),
      ],
      [otherRoom("theirs", { starredAt: day(3) })],
    );

    expect(rowProps("theirs").workspaceName).toBe("Other Org");
    expect(rowProps("mine").workspaceName).toBeUndefined();
    expect(rowProps("everywhere").workspaceName).toBeUndefined();
  });

  it("names the personal workspace by its own name", async () => {
    await renderWithPins(
      [],
      [
        otherRoom("assistant", {
          starredAt: day(1),
          kind: "direct",
          discoverability: null,
          organizationId: null,
          organizationName: null,
        }),
      ],
    );

    expect(rowProps("assistant").workspaceName).toBe(
      "App.Tasks.Detail.personalWorkspace",
    );
  });

  it("draws an ordinary row, leaving who may manage it to the room", async () => {
    await renderWithPins([], [otherRoom("theirs", { starredAt: day(1) })]);

    expect(rowProps("theirs").elsewhere).toBeFalsy();
    expect(rowProps("theirs").canManageSettings).toBe(false);
  });

  it("never gives a Pinned room an Elsewhere row, or a place among the five", async () => {
    const unread = { unreadCount: 1, channelUnreadCount: 1 };
    await renderWithPins(
      [],
      [
        otherRoom("pinned-unread", { ...unread, starredAt: day(1) }),
        otherRoom("a", unread),
        otherRoom("b", unread),
        otherRoom("c", unread),
        otherRoom("d", unread),
        otherRoom("e", unread),
      ],
    );

    expect(pinnedRows()).toEqual(["pinned-unread"]);
    expect(elsewhereRows()).toEqual(["a", "b", "c", "d", "e"]);
    expect(screen.queryByText(/elsewhereMore/)).toBeNull();
  });

  it("paints what a read already brought without reading for an instant paint", async () => {
    const view = await renderWithPins(
      [],
      [otherRoom("theirs", { starredAt: day(1) })],
    );
    listElsewhereMock.mockClear();

    view.rerender(createOrganizationChatList({ paintOnly: true }));

    expect(pinnedRows()).toEqual(["theirs"]);
    expect(listElsewhereMock).not.toHaveBeenCalled();
  });

  describe("Pin on an Elsewhere row", () => {
    it("moves the room to Pinned, so it shows once", async () => {
      const room = otherRoom("launch", {
        unreadCount: 1,
        channelUnreadCount: 1,
      });
      await renderWithPins([], [room]);
      expect(elsewhereRows()).toEqual(["launch"]);

      act(() => {
        rowProps("launch").onRoomUpdated({ ...room, starredAt: day(1) });
      });

      await waitFor(() => expect(pinnedRows()).toEqual(["launch"]));
      expect(elsewhereRows()).toEqual([]);
    });

    it("moves a held row Core has stopped listing", async () => {
      const room = otherRoom("launch", {
        unreadCount: 1,
        channelUnreadCount: 1,
      });
      const design = otherRoom("design", {
        unreadCount: 1,
        channelUnreadCount: 1,
      });
      const view = await renderWithPins([], [room, design]);
      harnessPathname.current = "/chat/rooms/launch";
      view.rerender(createOrganizationChatList());
      await waitFor(() =>
        expect(elsewhereRows()).toEqual(["launch", "design"]),
      );
      readRoom("launch");
      listElsewhereMock.mockResolvedValue([design]);
      act(() => {
        notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      });
      await waitFor(() => expect(listElsewhereMock).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(elsewhereRows()).toEqual(["launch", "design"]),
      );

      act(() => {
        rowProps("launch").onRoomUpdated({
          ...rowProps("launch").room,
          starredAt: day(1),
        });
      });

      await waitFor(() => expect(pinnedRows()).toEqual(["launch"]));
      expect(elsewhereRows()).toEqual(["design"]);
    });

    it("does not bring a held row back once it is pinned, read and unpinned", async () => {
      const room = otherRoom("launch", {
        unreadCount: 1,
        channelUnreadCount: 1,
      });
      const view = await renderWithPins([], [room]);
      harnessPathname.current = "/chat/rooms/launch";
      view.rerender(createOrganizationChatList());
      await waitFor(() => expect(rowProps("launch")).toBeTruthy());

      act(() => {
        rowProps("launch").onRoomUpdated({ ...room, starredAt: day(1) });
      });
      await waitFor(() => expect(pinnedRows()).toEqual(["launch"]));
      readRoom("launch");
      await waitFor(() => expect(rowProps("launch").room.unreadCount).toBe(0));

      act(() => {
        rowProps("launch").onRoomUpdated({
          ...rowProps("launch").room,
          starredAt: null,
        });
      });

      await waitFor(() =>
        expect(screen.queryByText("App.Channels.pinned")).toBeNull(),
      );
      expect(elsewhereRows()).toEqual([]);
    });
  });

  describe("Unpin", () => {
    it("takes a read room off the list at once", async () => {
      const room = otherRoom("theirs", { starredAt: day(1) });
      await renderWithPins([], [room]);

      act(() => {
        rowProps("theirs").onRoomUpdated({ ...room, starredAt: null });
      });

      await waitFor(() =>
        expect(screen.queryByText("App.Channels.pinned")).toBeNull(),
      );
      expect(elsewhereRows()).toEqual([]);
    });

    it("puts a room with something unread back as an Elsewhere row", async () => {
      const room = otherRoom("theirs", {
        starredAt: day(1),
        unreadCount: 1,
        channelUnreadCount: 1,
      });
      await renderWithPins([], [room]);

      act(() => {
        rowProps("theirs").onRoomUpdated({ ...room, starredAt: null });
      });

      await waitFor(() => expect(elsewhereRows()).toEqual(["theirs"]));
      expect(screen.queryByText("App.Channels.pinned")).toBeNull();
    });

    it("keeps no row for an open room that is read", async () => {
      harnessPathname.current = "/chat/rooms/theirs";
      const room = otherRoom("theirs", {
        starredAt: day(1),
        unreadCount: 1,
        channelUnreadCount: 1,
      });
      await renderWithPins([], [room]);
      readRoom("theirs");
      await waitFor(() => expect(rowProps("theirs").room.unreadCount).toBe(0));

      act(() => {
        rowProps("theirs").onRoomUpdated({
          ...rowProps("theirs").room,
          starredAt: null,
        });
      });

      await waitFor(() =>
        expect(screen.queryByText("App.Channels.pinned")).toBeNull(),
      );
      expect(elsewhereRows()).toEqual([]);
    });
  });

  describe("a reorder", () => {
    const mine = myRoom("mine", { starredAt: day(1) });
    const theirs = otherRoom("theirs", { starredAt: day(2) });

    async function moveFirstRowDown() {
      await userEvent.click(
        screen.getByRole("button", { name: "App.Channels.reorderPinned" }),
      );
      const [handle] = screen.getAllByRole("button", {
        name: /^App\.Channels\.Actions\.reorderHandle /,
      });
      handle.focus();
      await userEvent.keyboard("{ArrowDown}");
    }

    it("names the workspace on a handle, whose row's link stands down", async () => {
      await renderWithPins([mine], [theirs]);

      await userEvent.click(
        screen.getByRole("button", { name: "App.Channels.reorderPinned" }),
      );

      const handle = screen.getByRole("button", {
        name: "App.Channels.Actions.reorderHandle theirs App.Channels.inWorkspace Other Org",
      });
      expect(handle).toHaveAttribute("title", "Other Org");
      expect(
        screen.getByRole("button", {
          name: "App.Channels.Actions.reorderHandle mine",
        }),
      ).not.toHaveAttribute("title");
    });

    it("writes the whole order through to both stores", async () => {
      reorderPinnedMock.mockResolvedValue({
        ok: true,
        value: [
          { roomId: "theirs", starredAt: day(5) },
          { roomId: "mine", starredAt: day(6) },
        ],
      });
      await renderWithPins([mine], [theirs]);
      // Core's answer from here on, which a reorder reads again.
      listElsewhereMock.mockResolvedValue([{ ...theirs, starredAt: day(5) }]);

      await moveFirstRowDown();

      expect(reorderPinnedMock).toHaveBeenCalledExactlyOnceWith([
        "theirs",
        "mine",
      ]);
      await waitFor(() => expect(pinnedRows()).toEqual(["theirs", "mine"]));
      // Core's keys in both stores, so a later read of one still sorts against
      // the other.
      await waitFor(() =>
        expect(rowProps("mine").room.starredAt).toEqual(day(6)),
      );
      await waitFor(() =>
        expect(rowProps("theirs").room.starredAt).toEqual(day(5)),
      );
      expect(pinnedRows()).toEqual(["theirs", "mine"]);
    });

    it("reads both stores again when it fails", async () => {
      reorderPinnedMock.mockResolvedValue({
        ok: false,
        error: { message: "nope" },
      });
      await renderWithPins([mine], [theirs]);
      listElsewhereMock.mockClear();

      await moveFirstRowDown();

      await waitFor(() => expect(listElsewhereMock).toHaveBeenCalled());
      await waitFor(() => expect(pinnedRows()).toEqual(["mine", "theirs"]));
    });
  });

  describe("the Unreads filter", () => {
    const FILTER = { name: "All unreads" };

    it("still lists every pin, and is not caught up beside an unread one", async () => {
      await renderWithPins(
        [],
        [
          otherRoom("theirs-read", { starredAt: day(1) }),
          otherRoom("theirs-unread", {
            starredAt: day(2),
            unreadCount: 1,
            channelUnreadCount: 1,
          }),
        ],
        { withChatsHeading: true },
      );

      await userEvent.click(screen.getByRole("button", FILTER));

      const list = document.querySelector('[data-slot="unread-inbox-pinned"]');
      expect(rowNamesIn(list)).toEqual(["theirs-read", "theirs-unread"]);
      expect(rowProps("theirs-read").workspaceName).toBe("Other Org");
      expect(
        document.querySelector('[data-slot="unread-caught-up"]'),
      ).toBeNull();
    });

    it("is not caught up beside an unread pin during an instant paint", async () => {
      const view = await renderWithPins(
        [],
        [
          otherRoom("theirs-unread", {
            starredAt: day(1),
            unreadCount: 1,
            channelUnreadCount: 1,
          }),
        ],
        { withChatsHeading: true },
      );
      await userEvent.click(screen.getByRole("button", FILTER));

      view.rerender(
        createOrganizationChatList({
          withChatsHeading: true,
          paintOnly: true,
        }),
      );

      expect(pinnedRowsUnderFilter()).toEqual(["theirs-unread"]);
      expect(
        document.querySelector('[data-slot="unread-caught-up"]'),
      ).toBeNull();
    });

    it("is caught up when only a read pin is left, and dims it", async () => {
      await renderWithPins(
        [],
        [otherRoom("theirs-read", { starredAt: day(1) })],
        { withChatsHeading: true },
      );

      await userEvent.click(screen.getByRole("button", FILTER));

      expect(
        document.querySelector('[data-slot="unread-caught-up"]'),
      ).not.toBeNull();
      expect(screen.getByText("theirs-read").closest("li")).toHaveAttribute(
        "data-read",
        "true",
      );
    });

    it("does not dim an unread pin of another workspace", async () => {
      await renderWithPins(
        [],
        [
          otherRoom("theirs-unread", {
            starredAt: day(1),
            unreadCount: 1,
            channelUnreadCount: 1,
          }),
        ],
        { withChatsHeading: true },
      );

      await userEvent.click(screen.getByRole("button", FILTER));

      expect(
        screen.getByText("theirs-unread").closest("li"),
      ).not.toHaveAttribute("data-read");
    });
  });

  describe("Mark all as read", () => {
    const MARK_ALL = "App.Channels.UnreadNav.markAllRead";
    const unread = { unreadCount: 1, channelUnreadCount: 1 };

    beforeEach(() => {
      harnessRealCatchUp.current = true;
    });

    it("clears Pinned rooms of other workspaces, and leaves Elsewhere rows", async () => {
      await renderWithPins(
        [],
        [
          otherRoom("theirs", { ...unread, starredAt: day(1) }),
          otherRoom("elsewhere", unread),
        ],
        { withChatsHeading: true },
      );

      await userEvent.click(
        screen.getByRole("button", { name: "All unreads" }),
      );
      await userEvent.click(screen.getByRole("button", { name: MARK_ALL }));

      expect(markAllReadMock).toHaveBeenCalledExactlyOnceWith([
        { roomId: "theirs", readRoom: true, lookThreads: false },
      ]);
    });

    it("adds a Pinned room of another workspace to none of Catch up's counts", async () => {
      await renderWithPins(
        [],
        [
          otherRoom("theirs", {
            ...unread,
            starredAt: day(1),
            unreadNeedsYouCount: 2,
            unreadThreadCount: 3,
          }),
        ],
        { withChatsHeading: true },
      );

      const CATCH_UP = "App.Channels.Signals.catchUp";
      expect(screen.getByRole("link", { name: CATCH_UP }).textContent).toBe(
        CATCH_UP,
      );
    });
  });

  describe("the folded Chats heading", () => {
    it("says something unread is inside for a Pinned room of another workspace", async () => {
      await renderWithPins(
        [],
        [
          otherRoom("theirs", {
            starredAt: day(1),
            unreadCount: 1,
            channelUnreadCount: 1,
          }),
        ],
        { withChatsHeading: true },
      );

      const heading = () =>
        screen.getByRole("button", { name: /^App\.Channels\.chats/ });
      await userEvent.click(heading());

      expect(heading()).toHaveTextContent("App.Channels.RoomUnread.unread");
    });
  });

  it("reads again when something changes, and keeps its one order", async () => {
    const theirs = otherRoom("theirs", { starredAt: day(2) });
    await renderWithPins([myRoom("mine", { starredAt: day(1) })], [theirs]);
    expect(pinnedRows()).toEqual(["mine", "theirs"]);

    listElsewhereMock.mockResolvedValue([]);
    act(() => {
      notifyOrganizationChatRoomsChanged({ collections: ["active"] });
    });

    await waitFor(() => expect(pinnedRows()).toEqual(["mine"]));
  });
});
