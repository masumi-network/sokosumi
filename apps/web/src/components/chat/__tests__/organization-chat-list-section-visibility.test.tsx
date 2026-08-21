import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptInvitationMock,
  emptyListResult,
  listPendingMock,
  listRoomsMock,
  makeInvitation,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
} from "./organization-chat-list-harness";

describe("OrganizationChatList section visibility", () => {
  beforeEach(() => {
    resetOrganizationChatListMocks();
  });

  it("hides Channels in a personal workspace", () => {
    renderOrganizationChatList({ organizationId: null });

    expect(screen.queryByText("App.Channels.title")).not.toBeInTheDocument();
    expect(
      screen.queryByText("App.Channels.Empty.onlyInOrganizations"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("App.Channels.directMessages")).toBeInTheDocument();
  });

  it("keeps Channels in an organization workspace when empty", () => {
    renderOrganizationChatList({ organizationId: "org-1" });

    expect(screen.getByText("App.Channels.title")).toBeInTheDocument();
    expect(
      screen.getByText("App.Channels.Empty.noChannels"),
    ).toBeInTheDocument();
    expect(screen.getByText("App.Channels.directMessages")).toBeInTheDocument();
  });

  it("hides External when there are no joined rooms and no pending invitations", () => {
    renderOrganizationChatList({ organizationId: "org-1" });

    expect(
      screen.queryByText("App.Channels.External.title"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("App.Channels.External.empty"),
    ).not.toBeInTheDocument();
  });

  it("shows External when a personal human Direct is not an org teammate", () => {
    const personal = makeRoom({
      id: "personal-dm",
      kind: "direct",
      myAccess: "member",
      discoverability: null,
      organizationId: null,
      organizationName: null,
      peerInActiveOrganization: false,
      name: "Guest User",
    });

    renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [personal],
    });

    expect(screen.getByText("App.Channels.External.title")).toBeInTheDocument();
    expect(screen.getByText("room")).toBeInTheDocument();
  });

  it("shows External when the user has joined an external room", async () => {
    const external = makeRoom({
      id: "ext-1",
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
      name: "Partners",
    });
    listRoomsMock.mockResolvedValue(emptyListResult([external]));

    renderOrganizationChatList({ organizationId: null, rooms: [external] });

    expect(
      await screen.findByText("App.Channels.External.title"),
    ).toBeInTheDocument();
    expect(screen.getByText("Partners")).toBeInTheDocument();
    expect(screen.queryByText("App.Channels.title")).not.toBeInTheDocument();
  });

  it("shows External when a pending invitation exists", async () => {
    const invitation = makeInvitation();
    listPendingMock.mockResolvedValue({ ok: true, value: [invitation] });

    renderOrganizationChatList({
      organizationId: "org-1",
      pendingInvitations: [invitation],
    });

    expect(
      await screen.findByText("App.Channels.External.title"),
    ).toBeInTheDocument();
    expect(screen.getByText("Partners")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("keeps External visible while the last pending invite is accepted", async () => {
    const invitation = makeInvitation();
    const joined = makeRoom({
      id: invitation.roomId,
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
      name: invitation.roomName,
    });
    listPendingMock.mockResolvedValue({ ok: true, value: [invitation] });
    listRoomsMock.mockReset();
    listRoomsMock.mockResolvedValueOnce(emptyListResult());
    let resolveRooms!: (value: ReturnType<typeof emptyListResult>) => void;
    listRoomsMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRooms = resolve;
      }),
    );
    acceptInvitationMock.mockResolvedValue({ ok: true, value: invitation });

    renderOrganizationChatList({
      organizationId: "org-1",
      pendingInvitations: [invitation],
    });

    expect(
      await screen.findByText("App.Channels.External.title"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: "App.Channels.External.accept" }),
    );

    await waitFor(() => {
      expect(listRoomsMock).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByText("App.Channels.External.title")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "App.Channels.loading" }),
    ).toBeInTheDocument();

    resolveRooms(emptyListResult([joined]));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", {
          name: "App.Channels.External.accept",
        }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("App.Channels.External.title")).toBeInTheDocument();
    expect(screen.getByText("Partners")).toBeInTheDocument();
  });
});
