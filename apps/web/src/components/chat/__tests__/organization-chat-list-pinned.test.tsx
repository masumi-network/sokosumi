import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  createOrganizationChatList,
  emptyListResult,
  listRoomsMock,
  makeRoom,
  renderOrganizationChatList,
  reorderPinnedMock,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

const pinnedRooms = [
  makeRoom({
    id: "launch",
    kind: "channel",
    myAccess: "member",
    starredAt: new Date("2026-08-01T00:00:00.000Z"),
  }),
  makeRoom({
    id: "design",
    kind: "channel",
    myAccess: "member",
    starredAt: new Date("2026-08-02T00:00:00.000Z"),
  }),
];
const rooms = [
  ...pinnedRooms,
  makeRoom({ id: "general", kind: "channel", myAccess: "member" }),
];

function rowLabels() {
  return screen
    .getAllByTestId("room-row")
    .map((row) => within(row).getAllByText(/./)[0]?.textContent);
}

describe("OrganizationChatList Pinned section", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
    listRoomsMock.mockResolvedValue(emptyListResult(rooms));
  });

  it("hides Pinned when nothing is pinned", () => {
    renderOrganizationChatList({ organizationId: "org-1" });

    expect(screen.queryByText("App.Channels.pinned")).not.toBeInTheDocument();
  });

  it("hides Pinned when rooms exist but none are pinned", () => {
    renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [rooms[2]],
    });

    expect(screen.queryByText("App.Channels.pinned")).not.toBeInTheDocument();
    expect(rowLabels()).toEqual(["general"]);
  });

  it("drops the section when the last pin goes, and keeps the room listed", () => {
    const { rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [rooms[0], rooms[2]],
    });
    expect(screen.getByText("App.Channels.pinned")).toBeInTheDocument();

    rerender(
      createOrganizationChatList({
        organizationId: "org-1",
        rooms: [
          makeRoom({ id: "launch", kind: "channel", myAccess: "member" }),
          rooms[2],
        ],
      }),
    );

    expect(screen.queryByText("App.Channels.pinned")).not.toBeInTheDocument();
    // Back under Channels, where activity order decides the place.
    expect(rowLabels().toSorted()).toEqual(["general", "launch"]);
  });

  const TOGGLE = "App.Channels.reorderPinned";
  const DONE = "App.Channels.reorderPinnedDone";
  const HANDLE = "App.Channels.Actions.reorderHandle";

  function handleOf(label: string) {
    const row = screen
      .getAllByTestId("room-row")
      .find((candidate) => within(candidate).queryByText(label));
    if (!row) throw new Error(`no row ${label}`);
    return within(row).getByRole("button", { name: HANDLE });
  }

  async function enterReorderMode() {
    await userEvent.click(screen.getByRole("button", { name: TOGGLE }));
  }

  it("lists pinned rooms first, in the reader's order, and only there", () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });

    expect(screen.getByText("App.Channels.pinned")).toBeInTheDocument();
    expect(rowLabels()).toEqual(["launch", "design", "general"]);
  });

  it("shows handles only in reorder mode, and only on pinned rows", async () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    expect(screen.queryByRole("button", { name: HANDLE })).toBeNull();

    await enterReorderMode();
    expect(screen.getAllByRole("button", { name: HANDLE })).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: DONE }));
    expect(screen.queryByRole("button", { name: HANDLE })).toBeNull();
  });

  it("ends reorder mode when the pins drop below two, and does not resume it", async () => {
    const { rerender } = renderOrganizationChatList({
      organizationId: "org-1",
      rooms,
    });
    await enterReorderMode();

    // Unpinned on another device: one pin left, so no toggle to leave with.
    rerender(
      createOrganizationChatList({
        organizationId: "org-1",
        rooms: [rooms[0], rooms[2]],
      }),
    );
    expect(screen.queryByRole("button", { name: HANDLE })).toBeNull();

    rerender(createOrganizationChatList({ organizationId: "org-1", rooms }));
    expect(screen.getByRole("button", { name: TOGGLE })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: HANDLE })).toBeNull();
  });

  it("offers no reorder mode for a single pinned room", () => {
    renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [rooms[0], rooms[2]],
    });

    expect(screen.queryByRole("button", { name: TOGGLE })).toBeNull();
  });

  it("moves a room with the arrow keys, at once, and stays on its handle", async () => {
    reorderPinnedMock.mockResolvedValue({ ok: true, value: [] });
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    await enterReorderMode();

    handleOf("launch").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(reorderPinnedMock).toHaveBeenCalledWith(["design", "launch"]);
    await waitFor(() =>
      expect(rowLabels()).toEqual(["design", "launch", "general"]),
    );
    expect(handleOf("launch")).toHaveFocus();
  });

  it("does nothing past either end", async () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    await enterReorderMode();

    handleOf("launch").focus();
    await userEvent.keyboard("{ArrowUp}");
    handleOf("design").focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(reorderPinnedMock).not.toHaveBeenCalled();
  });

  it("puts the order back when Core refuses it", async () => {
    reorderPinnedMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "nope" },
    });
    renderOrganizationChatList({ organizationId: "org-1", rooms });
    await enterReorderMode();

    handleOf("launch").focus();
    await userEvent.keyboard("{ArrowDown}");

    await waitFor(() => expect(reorderPinnedMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(rowLabels()).toEqual(["launch", "design", "general"]),
    );
  });
});
