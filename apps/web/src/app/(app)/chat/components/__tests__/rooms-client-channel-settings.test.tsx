import "./rooms-client-harness";
import type { ChatRoomMessage } from "@sokosumi/core-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestQueryProvider } from "@/test/query-provider";
import {
  channelRoom,
  coworkerParticipant,
  type RoomsClientProps,
  renderRoomsClient,
  updateRoomAction,
  userParticipant,
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

// External channels mount guest invites; their loads are not under test here.
vi.mock("../guest-invite-section", () => ({
  GuestInviteSection: () => null,
}));

/** The org roster failed to load: Core soft-fails it to an empty list. */
function membersFailed(
  overrides: Partial<RoomsClientProps>,
): Partial<RoomsClientProps> {
  return { organizationMembers: [], membersLoadFailed: true, ...overrides };
}

async function openEditChannel() {
  await userEvent.setup().click(screen.getByTestId("room-open-title"));
}

function renderRoom(overrides: Partial<RoomsClientProps>) {
  return renderRoomsClient(overrides, { wrapper: TestQueryProvider });
}

describe("RoomsClient channel settings without the org roster", () => {
  beforeEach(() => {
    updateRoomAction.mockReset();
    updateRoomAction.mockResolvedValue({ ok: true, value: channelRoom() });
  });

  it("gives an owner or admin name, topic, visibility and Archive when the roster failed", async () => {
    renderRoom(membersFailed({ isOrgOwnerOrAdmin: true }));
    await openEditChannel();

    expect(screen.getByLabelText("Dialog.name")).toHaveValue("general");
    expect(screen.getByLabelText("Dialog.topic")).toBeInTheDocument();
    expect(screen.getByText("Visibility.label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "archive" })).toBeInTheDocument();
  });

  it("saves name, topic and visibility for an owner or admin when the roster failed", async () => {
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
        memberUserIds: ["user-1"],
        coworkerIds: [],
        sokoBotIds: [],
      });
    });
  });

  // The picker list is empty, so the saved roster must come from the room
  // itself: every host human, coworker and bot stays; guests are never sent.
  it("keeps the room's participants when an owner or admin changes visibility with the roster failed", async () => {
    const user = userEvent.setup();
    renderRoom(
      membersFailed({
        isOrgOwnerOrAdmin: true,
        rooms: [
          channelRoom({
            discoverability: "external",
            userMembers: [
              { ...userParticipant("user-1", "Ada"), access: "member" },
              { ...userParticipant("user-2", "Bob"), access: "member" },
              { ...userParticipant("guest-1", "Gus"), access: "guest" },
            ],
            coworkerMembers: [coworkerParticipant("cow-1", "Soupie")],
            sokoBotMembers: [
              {
                id: "bot-1",
                name: "Soko",
                caption: null,
                image: null,
                avatarSeed: null,
                presence: "online",
              },
            ],
          }),
        ],
      }),
    );
    await user.click(screen.getByTestId("room-open-title"));

    await user.click(screen.getByLabelText("Visibility.private"));
    await user.click(screen.getByRole("button", { name: "Dialog.save" }));

    await waitFor(() => {
      expect(updateRoomAction).toHaveBeenCalledWith("room-channel", {
        name: "general",
        topic: "",
        discoverability: "private",
        memberUserIds: ["user-1", "user-2"],
        coworkerIds: ["cow-1"],
        sokoBotIds: ["bot-1"],
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
    await openEditChannel();

    expect(screen.getByLabelText("Dialog.name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "archive" })).toBeInTheDocument();
  });

  it("keeps a plain member to the roster and saves the roster only", async () => {
    const user = userEvent.setup();
    renderRoom(membersFailed({ isOrgOwnerOrAdmin: false }));
    await user.click(screen.getByTestId("room-open-title"));

    expect(screen.queryByLabelText("Dialog.name")).toBeNull();
    expect(screen.queryByText("Visibility.label")).toBeNull();
    expect(screen.queryByRole("button", { name: "archive" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Dialog.save" }));
    await waitFor(() => {
      expect(updateRoomAction).toHaveBeenCalledWith("room-channel", {
        memberUserIds: ["user-1"],
        coworkerIds: [],
        sokoBotIds: [],
      });
    });
  });

  it.each([
    ["a guest", { myAccess: "guest" as const }],
    ["a matched channel member", { discoverability: "matched" as const }],
  ])(
    "never gives %s the settings, even as an org owner or admin",
    async (_label, room) => {
      renderRoom(
        membersFailed({
          isOrgOwnerOrAdmin: true,
          rooms: [channelRoom(room)],
        }),
      );
      await openEditChannel();

      expect(screen.queryByLabelText("Dialog.name")).toBeNull();
      expect(screen.queryByRole("button", { name: "archive" })).toBeNull();
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
