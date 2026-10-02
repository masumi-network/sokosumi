import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import {
  channelRoom,
  type RoomsClientProps,
  renderRoomsClient,
  updateRoomAction,
} from "./rooms-client-harness";

vi.mock("@/app/chat/components/room-search-panel", () => ({
  RoomSearchPanel: () => null,
}));

vi.mock("@/app/chat/components/unread-threads-panel", () => ({
  UnreadThreadsPanel: () => null,
}));

vi.mock("../room-file-drop-zone", () => ({
  RoomFileDropZone: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../room-session-composer", () => ({
  RoomSessionComposer: () => null,
}));

vi.mock("../room-message-row", () => ({
  ChatMessageRow: ({ message }: { message: ChatRoomMessage }) => (
    <div>{message.content}</div>
  ),
}));

vi.mock("../thread-panel", () => ({
  ThreadPanel: () => null,
}));

vi.mock("../thread-list-panel", () => ({
  ThreadListPanel: () => null,
}));

/** The org roster failed to load: Core soft-fails it to an empty list. */
function membersFailed(
  overrides: Partial<RoomsClientProps>,
): Partial<RoomsClientProps> {
  return { organizationMembers: [], membersLoadFailed: true, ...overrides };
}

async function openChannelTitle() {
  await userEvent.setup().click(screen.getByTestId("room-open-title"));
}

function renderRoom(overrides: Partial<RoomsClientProps>) {
  return renderRoomsClient(overrides, { wrapper: TestQueryProvider });
}

describe("RoomsClient channel settings", () => {
  beforeEach(() => {
    updateRoomAction.mockReset();
    updateRoomAction.mockResolvedValue({ ok: true, value: channelRoom() });
  });

  it("gives an owner or admin name, topic, visibility and Archive when the roster failed", async () => {
    renderRoom(membersFailed({ isOrgOwnerOrAdmin: true }));
    await openChannelTitle();

    expect(screen.getByLabelText("Dialog.name")).toHaveValue("general");
    expect(screen.getByLabelText("Dialog.topic")).toBeInTheDocument();
    expect(screen.getByText("Visibility.label")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "archiveButton" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("room-roster-panel")).toBeNull();
  });

  it("saves name, topic and visibility for an owner or admin, and no roster", async () => {
    const user = userEvent.setup();
    renderRoom(membersFailed({ isOrgOwnerOrAdmin: true }));
    await user.click(screen.getByTestId("room-open-title"));

    const name = screen.getByLabelText("Dialog.name");
    await user.clear(name);
    await user.type(name, "announcements");
    await user.type(screen.getByLabelText("Dialog.topic"), "News");
    await user.click(screen.getByRole("button", { name: "Dialog.save" }));

    await waitFor(() => {
      expect(updateRoomAction).toHaveBeenCalledWith("room-channel", {
        name: "announcements",
        topic: "News",
        discoverability: "public",
      });
    });
  });

  it("gives an owner or admin the settings while the roster is still loading", async () => {
    renderRoom({
      isOrgOwnerOrAdmin: true,
      rosterPromise: new Promise(() => {
        /* roster never arrives */
      }),
    });
    await openChannelTitle();

    expect(screen.getByLabelText("Dialog.name")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "archiveButton" }),
    ).toBeInTheDocument();
  });

  it("opens the members panel, with Add, for a plain member's title", async () => {
    renderRoom(membersFailed({ isOrgOwnerOrAdmin: false }));
    await openChannelTitle();

    expect(screen.getByTestId("room-roster-panel")).toBeInTheDocument();
    expect(screen.getByTestId("room-roster-add")).toBeInTheDocument();
    expect(screen.queryByLabelText("Dialog.name")).toBeNull();
    expect(screen.queryByRole("button", { name: "archiveButton" })).toBeNull();
  });

  it.each([
    ["a guest", { myAccess: "guest" as const }],
    ["a matched channel member", { discoverability: "matched" as const }],
  ])(
    "opens a read-only members panel for %s, even as an org owner or admin",
    async (_label, room) => {
      renderRoom(
        membersFailed({
          isOrgOwnerOrAdmin: true,
          rooms: [channelRoom(room)],
        }),
      );
      await openChannelTitle();

      expect(screen.getByTestId("room-roster-panel")).toBeInTheDocument();
      expect(screen.queryByTestId("room-roster-add")).toBeNull();
      expect(screen.queryByLabelText("Dialog.name")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "archiveButton" }),
      ).toBeNull();
    },
  );

  it("keeps Direct titles static for an org owner or admin", () => {
    renderRoom(
      membersFailed({
        isOrgOwnerOrAdmin: true,
        rooms: [channelRoom({ kind: "direct", discoverability: null })],
      }),
    );

    expect(screen.getByTestId("room-open-title").tagName).not.toBe("BUTTON");
  });
});
