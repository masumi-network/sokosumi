import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatRoom, Member } from "@/lib/clients/generated/core";
import { CreateDirectDialog } from "../create-direct-dialog";

const {
  loadChatComposeRosterActionMock,
  createDirectRoomActionMock,
  ensureCoworkerDirectRoomActionMock,
  notifyOrganizationChatRoomsChangedMock,
  routerPushMock,
} = vi.hoisted(() => ({
  loadChatComposeRosterActionMock: vi.fn(),
  createDirectRoomActionMock: vi.fn(),
  ensureCoworkerDirectRoomActionMock: vi.fn(),
  notifyOrganizationChatRoomsChangedMock: vi.fn(),
  routerPushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    replace: vi.fn(),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { name?: string }) =>
    values?.name ? `${key}:${values.name}` : key,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/app/chat/actions", () => ({
  loadChatComposeRosterAction: loadChatComposeRosterActionMock,
  createDirectRoomAction: createDirectRoomActionMock,
  ensureCoworkerDirectRoomAction: ensureCoworkerDirectRoomActionMock,
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

function room(id: string): ChatRoom {
  return { id } as ChatRoom;
}

describe("CreateDirectDialog", () => {
  beforeEach(() => {
    loadChatComposeRosterActionMock.mockReset();
    createDirectRoomActionMock.mockReset();
    ensureCoworkerDirectRoomActionMock.mockReset();
    notifyOrganizationChatRoomsChangedMock.mockReset();
    routerPushMock.mockReset();
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: true,
      value: {
        currentUserId: "user-self",
        organizationName: "Acme",
        hasOrganization: true,
        canCreateExternal: false,
        members: [member("user-self", "Ada"), member("user-2", "Francis")],
        coworkers: [],
        membersLoadFailed: false,
      },
    });
    createDirectRoomActionMock.mockResolvedValue({
      ok: true,
      value: room("room-direct"),
    });
  });

  it("creates a Direct without navigating away first, then opens the room", async () => {
    const user = userEvent.setup();
    render(<CreateDirectDialog />);

    expect(screen.queryByRole("link")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Draft.title" }));

    await screen.findByRole("heading", { name: "Draft.title" });
    await user.click(await screen.findByRole("button", { name: /Francis/ }));
    await user.click(screen.getByRole("button", { name: "Dialog.create" }));

    await waitFor(() => {
      expect(createDirectRoomActionMock).toHaveBeenCalledWith({
        memberUserIds: ["user-2"],
      });
    });
    expect(ensureCoworkerDirectRoomActionMock).not.toHaveBeenCalled();
    expect(notifyOrganizationChatRoomsChangedMock).toHaveBeenCalledWith(
      room("room-direct"),
    );
    expect(routerPushMock).toHaveBeenCalledWith("/chat/rooms/room-direct");
  });

  it("ends the roster spinner when load fails", async () => {
    loadChatComposeRosterActionMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR", message: "Roster down" },
    });
    const user = userEvent.setup();
    render(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("heading", { name: "Draft.title" });
    await waitFor(() => {
      expect(screen.queryByText("loading")).toBeNull();
    });
    expect(screen.getByText("Draft.empty")).toBeTruthy();
    expect(createDirectRoomActionMock).not.toHaveBeenCalled();
  });

  it("scrolls the roster in its own overflow pane, not the dialog", async () => {
    const user = userEvent.setup();
    render(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("button", { name: /Francis/ });

    const scrollport = screen.getByTestId("direct-roster-scrollport");
    expect(scrollport).toHaveClass("overflow-y-auto");
    expect(scrollport.contains(screen.getByText("Francis"))).toBe(true);
  });

  it("closes without routing when dismissed", async () => {
    const user = userEvent.setup();
    render(<CreateDirectDialog />);

    await user.click(screen.getByRole("button", { name: "Draft.title" }));
    await screen.findByRole("heading", { name: "Draft.title" });
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Draft.title" })).toBeNull();
    });
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(createDirectRoomActionMock).not.toHaveBeenCalled();
  });
});
