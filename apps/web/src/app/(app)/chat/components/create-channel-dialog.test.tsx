import type { ChatRoom, Member } from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateChannelDialog } from "./create-channel-dialog";

const {
  loadChatComposeRosterActionMock,
  checkChannelSlugAvailabilityActionMock,
  createChannelActionMock,
  notifyOrganizationChatRoomsChangedMock,
  assignMock,
} = vi.hoisted(() => ({
  loadChatComposeRosterActionMock: vi.fn(),
  checkChannelSlugAvailabilityActionMock: vi.fn(),
  createChannelActionMock: vi.fn(),
  notifyOrganizationChatRoomsChangedMock: vi.fn(),
  assignMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, { rich: (key: string) => key }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/chat/actions", () => ({
  loadChatComposeRosterAction: loadChatComposeRosterActionMock,
  checkChannelSlugAvailabilityAction: checkChannelSlugAvailabilityActionMock,
  createChannelAction: createChannelActionMock,
}));

vi.mock("@/components/chat/organization-chat-events", () => ({
  notifyOrganizationChatRoomsChanged: notifyOrganizationChatRoomsChangedMock,
}));

function member(id: string, name: string): Member {
  return {
    id: `member-${id}`,
    organizationId: "org-1",
    role: "member",
    seatAssignedAt: null,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    lastSeenAt: null,
    user: {
      id,
      name,
      email: `${id}@example.com`,
      image: null,
    },
  };
}

describe("CreateChannelDialog", () => {
  beforeEach(() => {
    assignMock.mockReset();
    vi.stubGlobal("location", { assign: assignMock });
    loadChatComposeRosterActionMock.mockReset();
    checkChannelSlugAvailabilityActionMock.mockReset();
    createChannelActionMock.mockReset();
    notifyOrganizationChatRoomsChangedMock.mockReset();
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [member("user-self", "Ada")],
        coworkers: [],
        sokoBots: [],
        membersLoadFailed: false,
      },
    });
    checkChannelSlugAvailabilityActionMock.mockResolvedValue({
      ok: true,
      value: { status: "free" },
    });
    createChannelActionMock.mockResolvedValue({
      ok: true,
      value: { id: "room-channel" } as ChatRoom,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens in place without navigating", async () => {
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await screen.findByRole("heading", { name: "title" });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("does not treat a roster load failure as personal workspace", async () => {
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Roster down" },
    });
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await screen.findByText("Empty.rosterLoadFailedTitle");
    expect(screen.queryByText("NoOrganization.description")).toBeNull();
  });

  it("blocks channel creation until member roster load succeeds", async () => {
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [],
        coworkers: [],
        sokoBots: [],
        membersLoadFailed: true,
      },
    });
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await screen.findByText("Empty.membersLoadFailedTitle");
    expect(screen.queryByLabelText("nameLabel")).toBeNull();
    expect(screen.queryByRole("button", { name: "next" })).toBeNull();
    expect(createChannelActionMock).not.toHaveBeenCalled();

    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [member("user-self", "Ada")],
        coworkers: [],
        sokoBots: [],
        membersLoadFailed: false,
      },
    });
    await user.click(
      screen.getByRole("button", { name: "Empty.membersLoadFailedRetry" }),
    );
    await screen.findByLabelText("nameLabel");
    expect(loadChatComposeRosterActionMock).toHaveBeenCalledTimes(2);
  });

  it("creates a channel in place, then opens the room", async () => {
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await screen.findByLabelText("nameLabel");
    await user.type(screen.getByLabelText("nameLabel"), "Launch");
    expect(screen.queryByLabelText("slugLabel")).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "next" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "next" }));
    await user.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() => {
      expect(createChannelActionMock).toHaveBeenCalledWith({
        name: "Launch",
        slug: "launch",
        discoverability: "public",
        memberUserIds: ["user-self"],
        coworkerIds: [],
        sokoBotIds: [],
      });
    });
    expect(notifyOrganizationChatRoomsChangedMock).toHaveBeenCalledWith({
      id: "room-channel",
    });
    expect(assignMock).toHaveBeenCalledWith("/chat/rooms/room-channel");
  });

  it("asks for the name first and opens the link only on request", async () => {
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    const name = await screen.findByLabelText("nameLabel");
    expect(name).toHaveFocus();
    expect(screen.getByText("linkEmpty")).toBeInTheDocument();
    await user.type(name, "Launch plans");
    expect(name).toHaveAccessibleDescription(/linkHelp/);

    await user.click(screen.getByRole("button", { name: "changeLink" }));
    const link = screen.getByLabelText("slugLabel");
    expect(link).toHaveFocus();
    expect(link).toHaveValue("launch-plans");
    await user.clear(link);
    await user.type(link, "launch");
    await user.type(name, " 2026");
    expect(link).toHaveValue("launch");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "next" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "next" }));
    await user.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() => {
      expect(createChannelActionMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Launch plans 2026", slug: "launch" }),
      );
    });
  });

  it("opens the link field with the reason when the name's link is taken", async () => {
    checkChannelSlugAvailabilityActionMock.mockResolvedValue({
      ok: true,
      value: { status: "taken" },
    });
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await user.type(await screen.findByLabelText("nameLabel"), "Launch");

    expect(await screen.findByRole("alert")).toHaveTextContent("slugTaken");
    expect(screen.getByLabelText("slugLabel")).toHaveValue("launch");
    expect(screen.getByLabelText("nameLabel")).toHaveFocus();
    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
  });

  it("opens the link field when the name has nothing a link can use", async () => {
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await user.type(await screen.findByLabelText("nameLabel"), "日本");

    expect(await screen.findByRole("alert")).toHaveTextContent("slugInvalid");
    expect(screen.getByLabelText("slugLabel")).toHaveValue("");
  });

  it("says the link is being checked while the check runs", async () => {
    checkChannelSlugAvailabilityActionMock.mockImplementation(
      () => new Promise(() => {}),
    );
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await user.type(await screen.findByLabelText("nameLabel"), "Launch");

    expect(screen.getByLabelText("nameLabel")).toHaveAccessibleDescription(
      /slugChecking/,
    );
    expect(screen.getByRole("button", { name: "changeLink" })).toBeVisible();
  });

  it("moves focus to Link when a pending check finds the link taken while Change link has focus", async () => {
    let settle: (value: unknown) => void = () => {};
    checkChannelSlugAvailabilityActionMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await user.type(await screen.findByLabelText("nameLabel"), "Launch");
    await waitFor(() =>
      expect(checkChannelSlugAvailabilityActionMock).toHaveBeenCalled(),
    );
    screen.getByRole("button", { name: "changeLink" }).focus();
    await act(async () => settle({ ok: true, value: { status: "taken" } }));

    expect(await screen.findByRole("alert")).toHaveTextContent("slugTaken");
    expect(screen.getByLabelText("slugLabel")).toHaveFocus();
  });

  it("keeps the Link field open while a new name is checked", async () => {
    checkChannelSlugAvailabilityActionMock
      .mockResolvedValueOnce({ ok: true, value: { status: "taken" } })
      .mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    const name = await screen.findByLabelText("nameLabel");
    await user.type(name, "Launch");
    await screen.findByRole("alert");
    await user.type(name, " plans");

    expect(screen.getByLabelText("slugLabel")).toHaveValue("launch-plans");
    expect(name).toHaveFocus();
  });

  it("keeps a create-time conflict on Link and focuses it while the recheck is pending", async () => {
    checkChannelSlugAvailabilityActionMock
      .mockResolvedValueOnce({ ok: true, value: { status: "free" } })
      .mockImplementation(() => new Promise(() => {}));
    createChannelActionMock.mockResolvedValue({
      ok: false,
      error: {
        code: CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN,
        message: "taken",
      },
    });
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await user.type(await screen.findByLabelText("nameLabel"), "Launch");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "next" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "next" }));
    await user.click(screen.getByRole("button", { name: "create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("slugTaken");
    const link = screen.getByLabelText("slugLabel");
    expect(link).toHaveValue("launch");
    expect(link).toHaveFocus();
    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
  });
});
