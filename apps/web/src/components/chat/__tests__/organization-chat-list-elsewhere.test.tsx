import type { ChatRoom } from "@sokosumi/core-client";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const PERSONAL_LABEL = "App.Tasks.Detail.personalWorkspace";

function elsewhereRoom(
  id: string,
  overrides: Partial<ChatRoom> = {},
): ChatRoom {
  return makeRoom({
    id,
    kind: "channel",
    myAccess: "member",
    organizationId: "org-2",
    organizationName: "Other Org",
    unreadCount: 1,
    channelUnreadCount: 1,
    ...overrides,
  });
}

function elsewhereList() {
  return document.querySelector<HTMLElement>('[data-slot="elsewhere-rows"]');
}

function rowNames() {
  const list = elsewhereList();
  return list
    ? within(list)
        .queryAllByTestId("room-row")
        .map((row) => row.firstElementChild?.textContent)
    : [];
}

async function findElsewhereRow(name: string) {
  await screen.findByText(name);
}

function rowProps(id: string) {
  return harnessRowProps.get(id) as {
    room: ChatRoom;
    href: string;
    elsewhere?: boolean;
    canManageSettings?: boolean;
    onRoomUpdated: (room: ChatRoom) => void;
  };
}

function readRoom(detail: { roomId: string; room?: ChatRoom }) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(ORGANIZATION_CHAT_ROOM_READ_EVENT, { detail }),
    );
  });
}

beforeEach(() => {
  resetOrganizationChatListMocks();
  clearRoomReadOverlays();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("OrganizationChatList Elsewhere rows", () => {
  it("adds nothing while the reader's other workspaces hold nothing unread", async () => {
    renderOrganizationChatList({ withChatsHeading: true });

    await waitFor(() => expect(listElsewhereMock).toHaveBeenCalledOnce());
    expect(elsewhereList()).toBeNull();
    expect(screen.queryByText(/elsewhereMore/)).toBeNull();
  });

  it.each([
    ["the sidebar", true],
    ["the phone's Chats page", false],
  ])("shows a row under Catch up on %s", async (_name, withChatsHeading) => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);

    renderOrganizationChatList({ withChatsHeading });

    await findElsewhereRow("launch");
    const catchUp = screen.getByTestId("chat-unread-nav-rows");
    const list = elsewhereList() as HTMLElement;
    expect(catchUp.compareDocumentPosition(list)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(list.getAttribute("aria-label")).toBe(
      "App.Channels.UnreadNav.elsewhereLabel",
    );
    expect(rowProps("launch").href).toBe("/chat/rooms/launch");
  });

  it("names the room's workspace on its second line", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);

    renderOrganizationChatList();

    expect(await screen.findByText("Other Org")).toBeTruthy();
  });

  it("labels a room of the personal workspace Personal", async () => {
    listElsewhereMock.mockResolvedValue([
      elsewhereRoom("assistant", {
        kind: "direct",
        organizationId: null,
        organizationName: null,
      }),
    ]);

    renderOrganizationChatList();

    expect(await screen.findByText(PERSONAL_LABEL)).toBeTruthy();
  });

  it("leaves who may manage the room to the room", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);

    renderOrganizationChatList();
    await findElsewhereRow("launch");

    expect(rowProps("launch").elsewhere).toBe(true);
    expect(rowProps("launch").canManageSettings).toBe(false);
  });

  it("keeps Core's order, and shares what is past five in one row into Catch up", async () => {
    listElsewhereMock.mockResolvedValue(
      ["a", "b", "c", "d", "e", "f", "g"].map((id) => elsewhereRoom(id)),
    );

    renderOrganizationChatList();
    await findElsewhereRow("a");

    expect(rowNames()).toEqual(["a", "b", "c", "d", "e"]);
    const overflow = screen.getByRole("link", {
      name: "App.Channels.UnreadNav.elsewhereMore 2",
    });
    expect(overflow.getAttribute("href")).toBe("/chat/catch-up");
  });

  it("always gives a room naming the reader a row, past five", async () => {
    listElsewhereMock.mockResolvedValue([
      ...["a", "b", "c", "d", "e", "f", "g"].map((id) =>
        elsewhereRoom(id, { unreadMentionCount: 1 }),
      ),
      elsewhereRoom("plain"),
    ]);

    renderOrganizationChatList();
    await findElsewhereRow("a");

    expect(rowNames()).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
    expect(
      screen.getByRole("link", {
        name: "App.Channels.UnreadNav.elsewhereMore 1",
      }),
    ).toBeTruthy();
  });

  it("gives a room whose only unread is a Thread reply a row", async () => {
    listElsewhereMock.mockResolvedValue([
      elsewhereRoom("threads", {
        unreadCount: 2,
        channelUnreadCount: 0,
        threadUnreadCount: 2,
        unreadThreadCount: 1,
      }),
    ]);

    renderOrganizationChatList();

    await findElsewhereRow("threads");
    expect(rowProps("threads").room.threadUnreadCount).toBe(2);
  });

  it("keeps the rows with the Unreads filter on", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);

    renderOrganizationChatList();
    await findElsewhereRow("launch");

    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    expect(rowNames()).toEqual(["launch"]);
  });

  describe("the Unreads filter's caught-up message", () => {
    function caughtUpMessage() {
      return document.querySelector('[data-slot="unread-caught-up"]');
    }

    it("stays away while an Elsewhere row is unread", async () => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      renderOrganizationChatList();
      await findElsewhereRow("launch");

      await userEvent.click(
        screen.getByRole("button", { name: "All unreads" }),
      );

      expect(rowNames()).toEqual(["launch"]);
      expect(caughtUpMessage()).toBeNull();
    });

    it("stays away for an unread room past the cap", async () => {
      listElsewhereMock.mockResolvedValue(
        ["a", "b", "c", "d", "e", "f"].map((id) => elsewhereRoom(id)),
      );
      renderOrganizationChatList();
      await findElsewhereRow("a");

      await userEvent.click(
        screen.getByRole("button", { name: "All unreads" }),
      );

      expect(caughtUpMessage()).toBeNull();
    });

    it("shows when the only Elsewhere row left is the open room, read", async () => {
      harnessPathname.current = "/chat/rooms/launch";
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      renderOrganizationChatList();
      await findElsewhereRow("launch");

      readRoom({ roomId: "launch" });
      await userEvent.click(
        screen.getByRole("button", { name: "All unreads" }),
      );

      expect(rowNames()).toEqual(["launch"]);
      await waitFor(() => expect(caughtUpMessage()).not.toBeNull());
    });
  });

  it("reads nothing for an instant paint", async () => {
    listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);

    renderOrganizationChatList({ paintOnly: true });
    await act(async () => {});

    expect(listElsewhereMock).not.toHaveBeenCalled();
    expect(elsewhereList()).toBeNull();
  });

  describe("the folded Chats heading", () => {
    function chatsHeading() {
      return screen.getByRole("button", { name: /^App\.Channels\.chats/ });
    }

    it("says something unread is inside for a room elsewhere", async () => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      renderOrganizationChatList({ withChatsHeading: true });
      await findElsewhereRow("launch");

      await userEvent.click(chatsHeading());

      expect(chatsHeading()).toHaveTextContent(
        "App.Channels.RoomUnread.unread",
      );
    });

    it("says the reader is named for a mention elsewhere", async () => {
      listElsewhereMock.mockResolvedValue([
        elsewhereRoom("launch", { unreadMentionCount: 1 }),
      ]);
      renderOrganizationChatList({ withChatsHeading: true });
      await findElsewhereRow("launch");

      await userEvent.click(chatsHeading());

      expect(chatsHeading()).toHaveTextContent(
        "App.Channels.RoomMentions.mentionsYou",
      );
    });
  });

  // Catch up and Mark all as read keep to the active workspace (ADR-0061).
  describe("Catch up", () => {
    const CATCH_UP = "App.Channels.Signals.catchUp";
    const MARK_ALL = "App.Channels.UnreadNav.markAllRead";

    const mine = makeRoom({
      id: "mine",
      kind: "channel",
      myAccess: "member",
      unreadCount: 1,
      channelUnreadCount: 1,
    });

    beforeEach(() => {
      harnessRealCatchUp.current = true;
    });

    it("adds nothing to its count for a room elsewhere", async () => {
      listElsewhereMock.mockResolvedValue([
        elsewhereRoom("launch", {
          unreadNeedsYouCount: 2,
          unreadThreadCount: 3,
          unreadThreadMentionCount: 1,
        }),
      ]);
      renderOrganizationChatList({ withChatsHeading: true });
      await findElsewhereRow("launch");

      expect(screen.getByRole("link", { name: CATCH_UP }).textContent).toBe(
        CATCH_UP,
      );
    });

    it("leaves a room elsewhere unread when Mark all as read runs", async () => {
      listRoomsMock.mockResolvedValue(emptyListResult([mine]));
      listElsewhereMock.mockResolvedValue([
        elsewhereRoom("launch", { unreadMentionCount: 1 }),
      ]);
      renderOrganizationChatList({ rooms: [mine], withChatsHeading: true });
      await findElsewhereRow("launch");

      await userEvent.click(
        screen.getByRole("button", { name: "All unreads" }),
      );
      await userEvent.click(screen.getByRole("button", { name: MARK_ALL }));

      expect(markAllReadMock).toHaveBeenCalledExactlyOnceWith([
        { roomId: "mine", readRoom: true, lookThreads: false },
      ]);
      expect(rowProps("launch").room.unreadMentionCount).toBe(1);
    });

    it("offers no Mark all as read while only a room elsewhere is unread", async () => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      renderOrganizationChatList({ withChatsHeading: true });
      await findElsewhereRow("launch");

      await userEvent.click(
        screen.getByRole("button", { name: "All unreads" }),
      );

      expect(screen.queryByRole("button", { name: MARK_ALL })).toBeNull();
    });
  });

  describe("live", () => {
    async function settle(ms = 0) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    it("adds a row when a message arrives, with no reload and no polling", async () => {
      vi.useFakeTimers();
      renderOrganizationChatList();
      await settle();
      expect(listElsewhereMock).toHaveBeenCalledOnce();

      // Nothing happened, so nothing is read, however long the reader waits.
      await settle(10 * 60_000);
      expect(listElsewhereMock).toHaveBeenCalledOnce();

      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      act(() => {
        notifyOrganizationChatRoomsChanged({
          collections: ["active"],
          roomId: "launch",
        });
      });
      await settle();

      expect(listElsewhereMock).toHaveBeenCalledTimes(2);
      expect(rowNames()).toEqual(["launch"]);
    });

    it("costs a busy room far fewer reads than messages", async () => {
      vi.useFakeTimers();
      renderOrganizationChatList();
      await settle();
      listElsewhereMock.mockClear();

      for (let message = 0; message < 20; message += 1) {
        act(() => {
          notifyOrganizationChatRoomsChanged({ collections: ["active"] });
        });
        await settle(100);
      }
      await settle(5_000);

      expect(listElsewhereMock).toHaveBeenCalledTimes(2);
    });

    it("ignores a change to another collection", async () => {
      vi.useFakeTimers();
      renderOrganizationChatList();
      await settle();
      listElsewhereMock.mockClear();

      act(() => {
        notifyOrganizationChatRoomsChanged({ collections: ["archived"] });
      });
      await settle(5_000);

      expect(listElsewhereMock).not.toHaveBeenCalled();
    });

    it("drops a row the reader left or was removed from at once", async () => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      renderOrganizationChatList();
      await findElsewhereRow("launch");

      act(() => {
        notifyOrganizationChatRoomsChanged({ removedRoomId: "launch" });
      });

      await waitFor(() => expect(elsewhereList()).toBeNull());
    });

    it("keeps its rows when a later read fails", async () => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      renderOrganizationChatList();
      await findElsewhereRow("launch");
      listElsewhereMock.mockClear();

      listElsewhereMock.mockResolvedValue(null);
      await act(async () => {
        notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      });
      await waitFor(() => expect(listElsewhereMock).toHaveBeenCalledOnce());
      await act(async () => {});

      expect(rowNames()).toEqual(["launch"]);
    });

    // A read in another tab or on another device sends no event.
    it("reads again when the reader comes back to the window", async () => {
      const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      renderOrganizationChatList();
      await findElsewhereRow("launch");

      hasFocus.mockReturnValue(false);
      act(() => {
        window.dispatchEvent(new Event("blur"));
      });
      listElsewhereMock.mockResolvedValue([]);
      hasFocus.mockReturnValue(true);
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });

      await waitFor(() => expect(elsewhereList()).toBeNull());
    });

    it("starts over in a new workspace, without the old one's rows", async () => {
      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      const view = renderOrganizationChatList();
      await findElsewhereRow("launch");

      listElsewhereMock.mockReturnValue(new Promise(() => {}));
      view.rerender(createOrganizationChatList({ organizationId: "org-2" }));

      expect(elsewhereList()).toBeNull();
    });
  });

  describe("the open room", () => {
    async function renderOpenRow() {
      harnessPathname.current = "/chat/rooms/launch";
      listElsewhereMock.mockResolvedValue([
        elsewhereRoom("launch", { unreadMentionCount: 1 }),
        elsewhereRoom("design"),
      ]);
      const view = renderOrganizationChatList();
      await findElsewhereRow("launch");
      return view;
    }

    it("clears the mark when the room is read, and keeps the workspace", async () => {
      await renderOpenRow();

      // A read's answer does not load the Organization's name.
      readRoom({
        roomId: "launch",
        room: elsewhereRoom("launch", {
          unreadCount: 0,
          channelUnreadCount: 0,
          unreadMentionCount: 0,
          organizationName: null,
        }),
      });

      await waitFor(() => expect(rowProps("launch").room.unreadCount).toBe(0));
      expect(rowProps("launch").room.unreadMentionCount).toBe(0);
      expect(rowProps("launch").room.organizationName).toBe("Other Org");
      expect(rowNames()).toEqual(["launch", "design"]);
    });

    it("stays when Core stops listing it, where it stood, with its mark cleared", async () => {
      await renderOpenRow();

      listElsewhereMock.mockResolvedValue([elsewhereRoom("design")]);
      act(() => {
        notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      });

      await waitFor(() =>
        expect(rowProps("launch").room.unreadMentionCount).toBe(0),
      );
      expect(rowProps("launch").room.unreadCount).toBe(0);
      expect(rowNames()).toEqual(["launch", "design"]);
    });

    it("leaves once the reader moves on", async () => {
      const view = await renderOpenRow();
      readRoom({
        roomId: "launch",
        room: elsewhereRoom("launch", {
          unreadCount: 0,
          channelUnreadCount: 0,
          unreadMentionCount: 0,
        }),
      });

      harnessPathname.current = "/chat/rooms/other";
      view.rerender(createOrganizationChatList());

      expect(rowNames()).toEqual(["design"]);
    });

    it("does not come back once read and left, when the reader returns", async () => {
      const view = await renderOpenRow();
      readRoom({
        roomId: "launch",
        room: elsewhereRoom("launch", {
          unreadCount: 0,
          channelUnreadCount: 0,
          unreadMentionCount: 0,
        }),
      });

      harnessPathname.current = "/tasks";
      view.rerender(createOrganizationChatList());
      harnessPathname.current = "/chat/rooms/launch";
      view.rerender(createOrganizationChatList());

      expect(rowNames()).toEqual(["design"]);
    });

    it("stays for the room still unread when the reader moves on", async () => {
      const view = await renderOpenRow();

      harnessPathname.current = "/tasks";
      view.rerender(createOrganizationChatList());

      expect(rowNames()).toEqual(["launch", "design"]);
    });

    // Nothing is added while everything is read (spec).
    it("adds no row for a read room opened by link when Core lists it before the read lands", async () => {
      harnessPathname.current = "/chat/rooms/launch";
      renderOrganizationChatList();
      await waitFor(() => expect(listElsewhereMock).toHaveBeenCalledOnce());

      listElsewhereMock.mockResolvedValue([elsewhereRoom("launch")]);
      act(() => {
        notifyOrganizationChatRoomsChanged({
          collections: ["active"],
          roomId: "launch",
        });
      });
      await findElsewhereRow("launch");

      readRoom({ roomId: "launch" });

      await waitFor(() => expect(rowNames()).toEqual([]));
    });

    it("holds a row that was showing when the room opened", async () => {
      listElsewhereMock.mockResolvedValue([
        elsewhereRoom("launch"),
        elsewhereRoom("design"),
      ]);
      const view = renderOrganizationChatList();
      await findElsewhereRow("launch");

      harnessPathname.current = "/chat/rooms/launch";
      view.rerender(createOrganizationChatList());
      readRoom({ roomId: "launch" });
      await waitFor(() => expect(rowProps("launch").room.unreadCount).toBe(0));

      expect(rowNames()).toEqual(["launch", "design"]);
    });

    it("lets a held row go when the reader is removed from the room", async () => {
      await renderOpenRow();
      listElsewhereMock.mockResolvedValue([elsewhereRoom("design")]);
      act(() => {
        notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      });
      await waitFor(() =>
        expect(rowProps("launch").room.unreadMentionCount).toBe(0),
      );

      act(() => {
        notifyOrganizationChatRoomsChanged({ removedRoomId: "launch" });
      });

      await waitFor(() => expect(rowNames()).toEqual(["design"]));
    });

    it("keeps a held row's own action once Core stops listing it", async () => {
      await renderOpenRow();
      listElsewhereMock.mockResolvedValue([elsewhereRoom("design")]);
      act(() => {
        notifyOrganizationChatRoomsChanged({ collections: ["active"] });
      });
      await waitFor(() =>
        expect(rowProps("launch").room.unreadMentionCount).toBe(0),
      );

      const mutedAt = new Date("2026-01-03T00:00:00.000Z");
      act(() => {
        rowProps("launch").onRoomUpdated({
          ...rowProps("launch").room,
          mutedAt,
        });
      });

      await waitFor(() =>
        expect(rowProps("launch").room.mutedAt).toEqual(mutedAt),
      );
      expect(rowNames()).toEqual(["launch", "design"]);
    });

    it("keeps its row past the cap while it is open", async () => {
      harnessPathname.current = "/chat/rooms/g";
      listElsewhereMock.mockResolvedValue(
        ["a", "b", "c", "d", "e", "f", "g"].map((id) => elsewhereRoom(id)),
      );

      renderOrganizationChatList();
      await findElsewhereRow("a");

      expect(rowNames()).toEqual(["a", "b", "c", "d", "e", "g"]);
    });
  });

  describe("the row's own actions", () => {
    it("takes a muted row away, and puts it back if the mute fails", async () => {
      const room = elsewhereRoom("launch");
      listElsewhereMock.mockResolvedValue([room]);
      renderOrganizationChatList();
      await findElsewhereRow("launch");

      act(() => {
        rowProps("launch").onRoomUpdated({
          ...room,
          mutedAt: new Date("2026-01-03T00:00:00.000Z"),
        });
      });
      await waitFor(() => expect(rowNames()).toEqual([]));

      act(() => {
        rowProps("launch").onRoomUpdated(room);
      });
      await waitFor(() => expect(rowNames()).toEqual(["launch"]));
    });

    it("keeps the workspace on an answer that carries no Organization name", async () => {
      const room = elsewhereRoom("launch");
      listElsewhereMock.mockResolvedValue([room]);
      renderOrganizationChatList();
      await findElsewhereRow("launch");

      act(() => {
        rowProps("launch").onRoomUpdated({
          ...room,
          organizationName: null,
          topic: "changed",
        });
      });

      await waitFor(() =>
        expect(rowProps("launch").room.topic).toBe("changed"),
      );
      expect(screen.getByText("Other Org")).toBeTruthy();
    });
  });
});
