import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRoom, Member } from "@/lib/clients/generated/core";
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
  useTranslations: () => (key: string) => key,
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
        orchestrators: [],
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
        orchestrators: [],
        membersLoadFailed: true,
      },
    });
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await screen.findByText("Empty.membersLoadFailedTitle");
    expect(screen.queryByLabelText("slugLabel")).toBeNull();
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
        orchestrators: [],
        membersLoadFailed: false,
      },
    });
    await user.click(
      screen.getByRole("button", { name: "Empty.membersLoadFailedRetry" }),
    );
    await screen.findByLabelText("slugLabel");
    expect(loadChatComposeRosterActionMock).toHaveBeenCalledTimes(2);
  });

  it("creates a channel in place, then opens the room", async () => {
    const user = userEvent.setup();
    render(<CreateChannelDialog />);

    await user.click(screen.getByRole("button", { name: "createChannel" }));
    await screen.findByLabelText("slugLabel");
    await user.type(screen.getByLabelText("slugLabel"), "launch");
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
        orchestratorIds: [],
      });
    });
    expect(notifyOrganizationChatRoomsChangedMock).toHaveBeenCalledWith({
      id: "room-channel",
    });
    expect(assignMock).toHaveBeenCalledWith("/chat/rooms/room-channel");
  });
});
