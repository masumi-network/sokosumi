import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { parseChatUnreadsFilterCookieHeader } from "@/lib/ui-preferences/chat-unreads-filter";

import {
  emptyListResult,
  listRoomsMock,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const CHATS = "App.Channels.chats";

const unreadChannel = makeRoom({
  id: "launch",
  name: "launch",
  kind: "channel",
  myAccess: "member",
  unreadCount: 2,
  channelUnreadCount: 2,
});
const readDirect = makeRoom({
  id: "dm",
  kind: "direct",
  myAccess: "member",
  channelUnreadCount: 0,
});

function chatsHeading() {
  return screen.getByRole("button", { name: new RegExp(`^${CHATS}`) });
}

function follows(first: Element, second: Element): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

beforeEach(() => {
  resetOrganizationChatListMocks();
  // The live refresh lands the same rooms, so they stay listed.
  listRoomsMock.mockResolvedValue(emptyListResult([unreadChannel, readDirect]));
});

/**
 * In the sidebar the chat area is one block, headed like the nav groups
 * (Work, Records, Marketing): Chats, then Catch up as its first row, then
 * the chat sections. The heading folds the whole block and carries the
 * Unreads chip, which used to sit on the Catch up row.
 */
describe("OrganizationChatList under its Chats heading", () => {
  it("heads the block, with Catch up first and every section under it", () => {
    renderOrganizationChatList({
      rooms: [unreadChannel, readDirect],
      withChatsHeading: true,
    });

    const heading = chatsHeading();
    const catchUp = screen.getByTestId("chat-unread-nav-rows");
    const content = catchUp.closest('[data-slot="collapsible-content"]');

    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(follows(heading, catchUp)).toBe(true);
    expect(content).not.toBeNull();
    if (!content) return;
    // Catch up leads the block; the sections follow inside the same fold.
    expect(
      within(content as HTMLElement).getByRole("button", {
        name: "App.Channels.directMessages",
      }),
    ).toBeInTheDocument();
    expect(
      follows(
        catchUp,
        within(content as HTMLElement).getByRole("button", {
          name: "App.Channels.directMessages",
        }),
      ),
    ).toBe(true);
  });

  it("folds the whole chat area, Catch up included", async () => {
    renderOrganizationChatList({
      rooms: [unreadChannel, readDirect],
      withChatsHeading: true,
    });

    await userEvent.click(chatsHeading());

    expect(chatsHeading()).toHaveAttribute("aria-expanded", "false");
    const catchUp = screen.getByTestId("chat-unread-nav-rows");
    expect(
      catchUp.closest('[data-slot="collapsible-content"]'),
    ).toHaveAttribute("data-state", "closed");
  });

  it("says on the folded heading that something unread is inside", async () => {
    renderOrganizationChatList({
      rooms: [unreadChannel, readDirect],
      withChatsHeading: true,
    });

    expect(chatsHeading()).not.toHaveTextContent("App.Channels.RoomUnread");
    await userEvent.click(chatsHeading());

    expect(chatsHeading()).toHaveTextContent("App.Channels.RoomUnread.unread");
  });

  // Catch up sits under the heading and counts unread Threads, which a
  // section's own heading leaves quiet: folded, the heading says so for it.
  it("marks the folded heading for a room whose only unread is a Thread", async () => {
    const threadOnlyChannel = makeRoom({
      id: "threads",
      name: "threads",
      kind: "channel",
      myAccess: "member",
      unreadCount: 1,
      channelUnreadCount: 0,
      threadUnreadCount: 1,
      unreadThreadCount: 1,
    });
    listRoomsMock.mockResolvedValue(
      emptyListResult([threadOnlyChannel, readDirect]),
    );
    renderOrganizationChatList({
      rooms: [threadOnlyChannel, readDirect],
      withChatsHeading: true,
    });

    await userEvent.click(chatsHeading());

    expect(chatsHeading()).toHaveTextContent("App.Channels.RoomUnread.unread");
  });

  it("carries the Unreads chip beside its title, not on the Catch up row", async () => {
    renderOrganizationChatList({
      rooms: [unreadChannel, readDirect],
      withChatsHeading: true,
    });

    const chip = screen.getByRole("button", { name: "All unreads" });
    const heading = chatsHeading();

    expect(heading.contains(chip)).toBe(false);
    expect(heading.parentElement?.contains(chip)).toBe(true);
    expect(
      within(screen.getByTestId("chat-unread-nav-rows")).queryByRole("button"),
    ).toBeNull();

    // Pressing the chip filters; it does not fold the block.
    await userEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(parseChatUnreadsFilterCookieHeader(document.cookie)).toBe(true);
    expect(chatsHeading()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getAllByTestId("room-row").map((row) => row.textContent),
    ).toEqual(["launch"]);
  });

  it("puts Mark all as read beside the chip while the filter is on", async () => {
    renderOrganizationChatList({
      rooms: [unreadChannel, readDirect],
      withChatsHeading: true,
    });

    expect(
      screen.queryByRole("button", { name: "Mark all as read" }),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "All unreads" }));

    const markAll = screen.getByRole("button", { name: "Mark all as read" });
    const chip = screen.getByRole("button", { name: "All unreads" });
    expect(chatsHeading().parentElement?.contains(markAll)).toBe(true);
    expect(follows(markAll, chip)).toBe(true);
    expect(
      within(screen.getByTestId("chat-unread-nav-rows")).queryByRole("button"),
    ).toBeNull();
  });

  // The phone's Chats page is titled Chats already: no second heading, and
  // the chip stays on the Catch up row there.
  it("leaves the heading out where the page is the Chats page", () => {
    renderOrganizationChatList({ rooms: [unreadChannel, readDirect] });

    expect(
      screen.queryByRole("button", { name: new RegExp(`^${CHATS}`) }),
    ).toBeNull();
    expect(
      within(screen.getByTestId("chat-unread-nav-rows")).getByRole("button", {
        name: "All unreads",
      }),
    ).toBeInTheDocument();
  });
});
