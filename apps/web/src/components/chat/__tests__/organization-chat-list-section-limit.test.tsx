import type { ChatRoom } from "@sokosumi/core-client";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
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
    renderOrganizationChatList({ rooms: channels() });

    expect(screen.getByText("ch-5")).toBeInTheDocument();
    expect(screen.queryByText("ch-6")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: SHOW_MORE })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("always lists an unread room and the open room past the limit", () => {
    harnessPathname.current = "/chat/rooms/ch-8";
    renderOrganizationChatList({
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
    renderOrganizationChatList({ rooms: [...channels(), ...directs] });

    expect(screen.getAllByRole("button", { name: SHOW_MORE })).toHaveLength(2);
  });
});
