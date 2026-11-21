import type { ChatRoom } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PageListSearchContext } from "@/components/page-list-search";
import {
  createOrganizationChatList,
  emptyListResult,
  harnessPathname,
  listRoomsMock,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const SHOW_MORE = "Show more";
const SHOW_LESS = "Show less";

// The harness turns every `SidebarMenuButton` into a bare marker; the row's
// own markup is `sidebar-section-show-more-row.test.tsx`'s.
vi.mock("../sidebar-section-show-more-row", () => ({
  SidebarSectionShowMoreRow: ({
    showAll,
    onShowAllChange,
  }: {
    showAll: boolean;
    onShowAllChange: (showAll: boolean) => void;
  }) => (
    <li>
      <button
        type="button"
        aria-expanded={showAll}
        onClick={() => onShowAllChange(!showAll)}
      >
        {showAll ? "Show less" : "Show more"}
      </button>
    </li>
  ),
}));

/** Nine read channels, newest first, so `ch-1` … `ch-5` make the limit. */
function channels(overrides: Record<string, Partial<ChatRoom>> = {}) {
  return Array.from({ length: 9 }, (_, index) => {
    const id = `ch-${index + 1}`;
    return makeRoom({
      id,
      kind: "channel",
      myAccess: "member",
      updatedAt: new Date(Date.UTC(2026, 0, 20 - index)),
      ...overrides[id],
    });
  });
}

describe("OrganizationChatList section limit", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    window.localStorage.clear();
  });

  it("stops a long section at the limit with a toggle for the rest", () => {
    renderOrganizationChatList({ rooms: channels(), paintOnly: true });

    expect(screen.getByText("ch-5")).toBeInTheDocument();
    expect(screen.queryByText("ch-6")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: SHOW_MORE })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("finds a channel past Show more and ranks its name ahead of another channel's topic", () => {
    const rooms = channels({
      "ch-1": { topic: "launch" },
      "ch-9": { name: "Launch team" },
    });
    render(
      <PageListSearchContext.Provider
        value={{ query: "launch", register: () => () => {} }}
      >
        {createOrganizationChatList({ rooms, paintOnly: true })}
      </PageListSearchContext.Provider>,
    );
    expect(
      screen.getAllByTestId("room-row").map((row) => row.textContent),
    ).toEqual(["Launch team", "ch-1"]);
  });

  it.each([
    {
      privateIds: ["ch-1", "ch-3", "ch-5", "ch-8"],
      visible: ["ch-2", "ch-4", "ch-1", "ch-3", "ch-5"],
    },
    {
      privateIds: ["ch-2", "ch-4", "ch-6", "ch-8"],
      visible: ["ch-1", "ch-3", "ch-5", "ch-2", "ch-4"],
    },
    {
      privateIds: ["ch-9"],
      visible: ["ch-1", "ch-2", "ch-3", "ch-4", "ch-9"],
    },
  ])(
    "balances the preview when private channels are $privateIds",
    ({ privateIds, visible }) => {
      const rooms = channels().map((room) =>
        privateIds.includes(room.id)
          ? { ...room, discoverability: "private" as const }
          : room,
      );
      renderOrganizationChatList({ rooms, paintOnly: true });

      expect(
        screen.getAllByTestId("room-row").map((row) => row.textContent),
      ).toEqual(visible);
    },
  );

  it("always lists an unread room and the open room past the limit", () => {
    harnessPathname.current = "/chat/rooms/ch-8";
    renderOrganizationChatList({
      paintOnly: true,
      rooms: channels({
        "ch-7": {
          unreadCount: 2,
          channelUnreadCount: 2,
        },
      }),
    });

    expect(screen.getByText("ch-7")).toBeInTheDocument();
    expect(screen.getByText("ch-8")).toBeInTheDocument();
    expect(screen.queryByText("ch-6")).not.toBeInTheDocument();
  });

  it("groups recent channels in the preview and restores the full order on expansion", async () => {
    const user = userEvent.setup();
    const rooms = channels({
      "ch-1": { mutedAt: new Date("2026-01-20") },
      "ch-2": { discoverability: "private" },
      "ch-3": { discoverability: "private" },
      "ch-8": {
        discoverability: "private",
        unreadCount: 1,
        channelUnreadCount: 1,
      },
    });
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
    renderOrganizationChatList({ rooms });
    const visibleIds = () =>
      screen.getAllByTestId("room-row").map((row) => row.textContent);
    const preview = ["ch-1", "ch-4", "ch-5", "ch-2", "ch-3", "ch-8"];

    expect(visibleIds()).toEqual(preview);
    await user.click(screen.getByRole("button", { name: SHOW_MORE }));
    expect(visibleIds()).toEqual([
      "ch-4",
      "ch-5",
      "ch-6",
      "ch-7",
      "ch-9",
      "ch-2",
      "ch-3",
      "ch-8",
      "ch-1",
    ]);
    await user.click(screen.getByRole("button", { name: SHOW_LESS }));
    expect(visibleIds()).toEqual(preview);
  });

  it("shows every room on Show more, back to the limit on Show less, and remembers it", async () => {
    const user = userEvent.setup();
    // The list refreshes from Core on mount; it must answer with the same rooms.
    listRoomsMock.mockResolvedValue(emptyListResult(channels()));
    const { unmount } = renderOrganizationChatList({ rooms: channels() });

    await user.click(screen.getByRole("button", { name: SHOW_MORE }));
    expect(screen.getByText("ch-8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: SHOW_LESS })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    unmount();
    renderOrganizationChatList({ rooms: channels() });
    expect(screen.getByText("ch-8")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: SHOW_LESS }));
    expect(screen.queryByText("ch-8")).not.toBeInTheDocument();
  });

  it("limits Direct messages on their own toggle", () => {
    const directs = Array.from({ length: 7 }, (_, index) =>
      makeRoom({
        id: `dm-${index + 1}`,
        kind: "direct",
        myAccess: "member",
        updatedAt: new Date(Date.UTC(2026, 0, 20 - index)),
      }),
    );
    renderOrganizationChatList({
      rooms: [...channels(), ...directs],
      paintOnly: true,
    });

    expect(screen.getAllByRole("button", { name: SHOW_MORE })).toHaveLength(2);
  });
});
