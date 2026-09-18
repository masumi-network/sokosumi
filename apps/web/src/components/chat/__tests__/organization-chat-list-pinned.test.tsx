import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
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

  it("lists pinned rooms first, in the reader's order, and only there", () => {
    renderOrganizationChatList({ organizationId: "org-1", rooms });

    expect(screen.getByText("App.Channels.pinned")).toBeInTheDocument();
    expect(rowLabels()).toEqual(["launch", "design", "general"]);
    // No move past either end.
    expect(screen.queryByText("Move up launch")).not.toBeInTheDocument();
    expect(screen.queryByText("Move down design")).not.toBeInTheDocument();
  });

  it("reorders at once and keeps the order Core confirms", async () => {
    reorderPinnedMock.mockResolvedValue({
      ok: true,
      value: [
        { roomId: "design", starredAt: new Date("2026-09-01T00:00:00.000Z") },
        { roomId: "launch", starredAt: new Date("2026-09-01T00:00:00.001Z") },
      ],
    });
    renderOrganizationChatList({ organizationId: "org-1", rooms });

    await userEvent.click(screen.getByText("Move down launch"));

    expect(reorderPinnedMock).toHaveBeenCalledWith(["design", "launch"]);
    await waitFor(() =>
      expect(rowLabels()).toEqual(["design", "launch", "general"]),
    );
  });

  it("puts the order back when Core refuses it", async () => {
    reorderPinnedMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "nope" },
    });
    renderOrganizationChatList({ organizationId: "org-1", rooms });

    await userEvent.click(screen.getByText("Move down launch"));

    await waitFor(() => expect(reorderPinnedMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(rowLabels()).toEqual(["launch", "design", "general"]),
    );
  });
});
