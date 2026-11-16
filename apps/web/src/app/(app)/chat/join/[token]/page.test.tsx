import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveLinkMock = vi.fn();
const getRoomMock = vi.fn();
const redirectMock = vi.fn((href: string) => {
  throw new Error(`redirect:${href}`);
});

vi.mock("next/navigation", () => ({
  redirect: (href: string) => redirectMock(href),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: async () => ({ user: { id: "user_1" } }),
}));

vi.mock("@/lib/services/chat-room.service", () => ({
  chatRoomService: {
    resolveRoomGuestInviteLink: (...args: unknown[]) =>
      resolveLinkMock(...args),
    getRoom: (...args: unknown[]) => getRoomMock(...args),
  },
}));

vi.mock("./components/chat-join-card", () => ({
  ChatJoinCard: ({ room }: { room: { name: string } }) => (
    <div>join:{room.name}</div>
  ),
  ChatJoinInvalidCard: ({ status }: { status: string }) => (
    <div>invalid:{status}</div>
  ),
}));

const room = {
  id: "room_1",
  name: "Launch Plans",
  organizationId: "org_1",
  organizationName: "Acme",
};

async function renderPage() {
  const { default: Page } = await import("./page");
  render(await Page({ params: Promise.resolve({ token: "tok_1" }) }));
}

describe("ChatJoinPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveLinkMock.mockResolvedValue({ status: "valid", room });
  });

  it("offers to join when the reader is not in the channel", async () => {
    getRoomMock.mockResolvedValue(null);

    await renderPage();

    expect(getRoomMock).toHaveBeenCalledWith("room_1");
    expect(screen.getByText("join:Launch Plans")).toBeVisible();
  });

  it("opens the channel when the reader is already in it", async () => {
    getRoomMock.mockResolvedValue({ id: "room_1" });

    await expect(renderPage()).rejects.toThrow("redirect:/chat/rooms/room_1");
  });

  it("still offers to join when the membership check fails", async () => {
    getRoomMock.mockRejectedValue(new Error("Core down"));

    await renderPage();

    expect(screen.getByText("join:Launch Plans")).toBeVisible();
  });

  it("shows why a link that is no longer valid cannot be used", async () => {
    resolveLinkMock.mockResolvedValue({ status: "revoked", room: null });

    await renderPage();

    expect(getRoomMock).not.toHaveBeenCalled();
    expect(screen.getByText("invalid:revoked")).toBeVisible();
  });
});
