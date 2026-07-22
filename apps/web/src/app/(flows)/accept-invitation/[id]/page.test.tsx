import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const getPendingInvitationMock = vi.fn();

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/services", () => ({
  organizationService: {
    getPendingInvitation: (...args: unknown[]) =>
      getPendingInvitationMock(...args),
  },
  PendingInvitationErrorCode: {
    EXPIRED: "EXPIRED",
    NOT_FOUND: "NOT_FOUND",
    INVITER_NOT_FOUND: "INVITER_NOT_FOUND",
  },
}));

vi.mock("./components/invitation-card", () => ({
  default: ({
    invitation,
    user,
  }: {
    invitation: { id: string };
    user?: { id: string };
  }) => (
    <div>
      invitation:{invitation.id}
      {user ? ` user:${user.id}` : " anonymous"}
    </div>
  ),
  InvitationErrorCard: ({ errorCode }: { errorCode: string }) => (
    <div>error:{errorCode}</div>
  ),
}));

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not wait for session before loading the invitation", async () => {
    let releaseSession: (() => void) | undefined;
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });

    getSessionMock.mockImplementation(async () => {
      await sessionGate;
      return { user: { id: "user_1" } };
    });

    getPendingInvitationMock.mockResolvedValue({
      invitation: {
        id: "inv_1",
        organizationId: "org_1",
        email: "a@example.com",
        role: "member",
        status: "pending",
        expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        inviterId: "user_2",
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        organization: { id: "org_1", name: "Acme", slug: "acme" },
        inviter: { id: "user_2", email: "b@example.com" },
      },
    });

    const pagePromise = import("./page").then(({ default: Page }) =>
      Page({ params: Promise.resolve({ id: "inv_1" }) }),
    );

    await vi.waitFor(() => {
      expect(getPendingInvitationMock).toHaveBeenCalledWith("inv_1");
    });

    // Invitation already in flight while session is still blocked.
    expect(getSessionMock).toHaveBeenCalled();
    releaseSession?.();

    render(await pagePromise);

    expect(screen.getByText("invitation:inv_1 user:user_1")).toBeVisible();
  });

  it("renders the error card when the invitation is not usable", async () => {
    getSessionMock.mockResolvedValue(null);
    getPendingInvitationMock.mockResolvedValue({
      error: "EXPIRED",
    });

    const { default: Page } = await import("./page");
    render(await Page({ params: Promise.resolve({ id: "inv_expired" }) }));

    expect(screen.getByText("error:EXPIRED")).toBeVisible();
  });
});
