import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptInvitationMock,
  createOrganizationChatList,
  emptyListResult,
  listPendingMock,
  listRoomsMock,
  makeInvitation,
  makeRoom,
  renderOrganizationChatList,
  resetOrganizationChatListMocks,
  sidebarMock,
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

  it("keeps archived rows off the collapsed rail, like every other non-row element", () => {
    renderOrganizationChatList({
      organizationId: "org-1",
      archivedRooms: [
        makeRoom({
          id: "old-launch",
          kind: "channel",
          myAccess: "member",
          name: "old-launch",
        }),
      ],
    });

    // Archived starts closed. A synchronous click, because the harness's
    // archived refresh resolves empty and would take the section away.
    fireEvent.click(screen.getByText("App.Channels.archivedChannels"));

    // An archived row is a plain div, not a `SidebarMenuButton`, so the
    // rail's icon rules do not reach it: without this it rendered a glyph
    // and a clipped name into the 56px rail whenever the section was open.
    const row = screen.getByText("old-launch").parentElement;
    expect(row?.className.split(/\s+/)).toContain(
      "group-data-[collapsible=icon]:hidden",
    );
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

  it("lists a personal human Direct under Direct Messages, not External", () => {
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

    expect(screen.getByText("App.Channels.directMessages")).toBeInTheDocument();
    expect(screen.getByText("room")).toBeInTheDocument();
    expect(
      screen.queryByText("App.Channels.External.title"),
    ).not.toBeInTheDocument();
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

  it("shows a closed section's rooms on the collapsed rail, which has no header to reopen it", async () => {
    const external = makeRoom({
      id: "ext-1",
      kind: "channel",
      myAccess: "guest",
      discoverability: "external",
      name: "Partners",
    });
    listRoomsMock.mockResolvedValue(emptyListResult([external]));
    const props = { organizationId: null, rooms: [external] };
    const { rerender } = render(createOrganizationChatList(props));

    await userEvent.click(
      await screen.findByText("App.Channels.External.title"),
    );
    expect(screen.queryByText("Partners")).not.toBeInTheDocument();

    sidebarMock.state = "collapsed";
    rerender(createOrganizationChatList(props));
    expect(screen.getByText("Partners")).toBeInTheDocument();

    // The phone sheet always shows headers, so a closed section stays closed
    // there even while the desktop state underneath says collapsed.
    sidebarMock.isMobile = true;
    rerender(createOrganizationChatList(props));
    expect(screen.queryByText("Partners")).not.toBeInTheDocument();
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

  it("paintOnly keeps section chrome and skips membership refresh", async () => {
    const channel = makeRoom({
      id: "general",
      kind: "channel",
      myAccess: "member",
      name: "general",
    });

    renderOrganizationChatList({
      organizationId: "org-1",
      rooms: [channel],
      paintOnly: true,
    });

    expect(screen.getByText("App.Channels.title")).toBeInTheDocument();
    expect(screen.getByText("general")).toBeInTheDocument();
    expect(screen.getByText("App.Channels.directMessages")).toBeInTheDocument();

    await waitFor(() => {
      expect(listRoomsMock).not.toHaveBeenCalled();
    });
  });
});
