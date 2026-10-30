import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearMembershipVisibleRoomsSnapshot,
  publishMembershipVisibleRooms,
} from "@/components/chat/membership-visible-rooms-store";
import {
  channelRoom,
  coworkerParticipant,
  organization,
  renderRoomsClient,
} from "./rooms-client-harness";

const handleSelectWorkspace = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({ handleSelectWorkspace, isPending: false }),
}));
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
  RoomSessionComposer: ({ channels }: { channels: { slug: string }[] }) => (
    <div data-testid="composer-channels">
      {channels.map((channel) => channel.slug).join(",")}
    </div>
  ),
}));
vi.mock("../room-message-row", () => ({ ChatMessageRow: () => null }));
vi.mock("../thread-panel", () => ({ ThreadPanel: () => null }));

const OTHER_WORKSPACE = { id: "org-2", name: "Other", slug: "other" };
const SWITCH_LABEL = "headerVisitSwitch";

describe("a Room visit's header", () => {
  beforeEach(() => handleSelectWorkspace.mockClear());

  it("names the room's workspace", () => {
    renderRoomsClient({ activeOrganization: OTHER_WORKSPACE });

    expect(
      screen.getByRole("button", { name: SWITCH_LABEL }),
    ).toHaveTextContent("Acme");
  });

  it("names the room's workspace on a visit from the personal workspace", () => {
    renderRoomsClient({ activeOrganization: null });

    expect(
      screen.getByRole("button", { name: SWITCH_LABEL }),
    ).toHaveTextContent("Acme");
  });

  it("switches to the room's workspace when that name is chosen", async () => {
    const user = userEvent.setup();
    renderRoomsClient({ activeOrganization: OTHER_WORKSPACE });

    await user.click(screen.getByRole("button", { name: SWITCH_LABEL }));

    expect(handleSelectWorkspace).toHaveBeenCalledWith("org-1");
  });

  it("names the personal workspace, and switches there", async () => {
    const user = userEvent.setup();
    renderRoomsClient({
      activeOrganization: OTHER_WORKSPACE,
      rooms: [
        channelRoom({
          kind: "direct",
          organizationId: null,
          organizationName: null,
          discoverability: null,
          slug: null,
          coworkerMembers: [coworkerParticipant("cow-1", "Elena")],
        }),
      ],
    });

    const name = screen.getByRole("button", { name: SWITCH_LABEL });
    expect(name).toHaveTextContent("personalWorkspace");
    await user.click(name);

    expect(handleSelectWorkspace).toHaveBeenCalledWith(null);
  });

  it("names nothing in the reader's own workspace", () => {
    renderRoomsClient({ activeOrganization: organization });

    expect(screen.queryByRole("button", { name: SWITCH_LABEL })).toBeNull();
  });

  it("names nothing for a room shown in every workspace", () => {
    renderRoomsClient({
      activeOrganization: OTHER_WORKSPACE,
      rooms: [channelRoom({ discoverability: "external" })],
    });

    expect(screen.queryByRole("button", { name: SWITCH_LABEL })).toBeNull();
  });
});

describe("a Room visit's channel suggestions", () => {
  afterEach(() => clearMembershipVisibleRoomsSnapshot());

  // A `#random` here would otherwise point at the active workspace's channel.
  it("leaves out the active workspace's channels", () => {
    publishMembershipVisibleRooms(
      [channelRoom({ id: "room-random", slug: "random" })],
      OTHER_WORKSPACE.id,
      "user-1",
    );

    renderRoomsClient({ activeOrganization: OTHER_WORKSPACE });

    expect(screen.getByTestId("composer-channels")).toHaveTextContent(
      /^general$/,
    );
  });

  it("keeps them in the reader's own workspace", () => {
    publishMembershipVisibleRooms(
      [channelRoom({ id: "room-random", slug: "random" })],
      organization.id,
      "user-1",
    );

    renderRoomsClient({ activeOrganization: organization });

    expect(screen.getByTestId("composer-channels")).toHaveTextContent(
      "random,general",
    );
  });
});
