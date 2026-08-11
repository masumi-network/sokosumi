import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getInvitationMock = vi.fn();

vi.mock("@/lib/services", () => ({
  chatRoomService: {
    getInvitation: (...args: unknown[]) => getInvitationMock(...args),
  },
}));

vi.mock("./components/chat-room-invitation-card", () => ({
  default: ({ invitation }: { invitation: { id: string; status: string } }) => (
    <div>
      invitation:{invitation.id} status:{invitation.status}
    </div>
  ),
  ChatRoomInvitationErrorCard: ({ errorCode }: { errorCode: string }) => (
    <div>error:{errorCode}</div>
  ),
}));

describe("ChatRoomInvitePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the invitation card when load succeeds", async () => {
    getInvitationMock.mockResolvedValue({
      id: "inv_1",
      roomId: "room_1",
      roomName: "partners",
      organizationId: "org_1",
      organizationName: "Acme",
      email: "guest@example.com",
      status: "pending",
      inviter: { id: "user_2", name: "Host" },
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const { default: Page } = await import("./page");
    render(await Page({ params: Promise.resolve({ id: "inv_1" }) }));

    expect(getInvitationMock).toHaveBeenCalledWith("inv_1");
    expect(screen.getByText("invitation:inv_1 status:pending")).toBeVisible();
  });

  it("renders not-found error when invitation is missing", async () => {
    getInvitationMock.mockResolvedValue(null);

    const { default: Page } = await import("./page");
    render(await Page({ params: Promise.resolve({ id: "missing" }) }));

    expect(screen.getByText("error:NOT_FOUND")).toBeVisible();
  });

  it("renders expired error when status is expired", async () => {
    getInvitationMock.mockResolvedValue({
      id: "inv_exp",
      roomId: "room_1",
      roomName: "partners",
      organizationId: "org_1",
      organizationName: "Acme",
      email: "guest@example.com",
      status: "expired",
      inviter: { id: "user_2", name: "Host" },
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      createdAt: new Date("2019-01-01T00:00:00.000Z"),
    });

    const { default: Page } = await import("./page");
    render(await Page({ params: Promise.resolve({ id: "inv_exp" }) }));

    expect(screen.getByText("error:EXPIRED")).toBeVisible();
  });
});
