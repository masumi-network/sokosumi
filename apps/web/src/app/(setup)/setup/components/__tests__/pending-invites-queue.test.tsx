import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastErrorMock = vi.fn();
const acceptInvitationMock = vi.fn();
const rejectInvitationMock = vi.fn();
const acceptOrganizationInviteLinkMock = vi.fn();
const activateOrganizationWorkspaceMock = vi.fn();
const clearPendingOrganizationJoinCookieActionMock = vi.fn();
const routerReplaceMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplaceMock,
    refresh: routerRefreshMock,
    push: vi.fn(),
  }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
      rejectInvitation: (...args: unknown[]) => rejectInvitationMock(...args),
    },
  },
}));

vi.mock("@/lib/actions", () => ({
  acceptOrganizationInviteLink: (...args: unknown[]) =>
    acceptOrganizationInviteLinkMock(...args),
}));

vi.mock("@/lib/actions/workspace-gate", () => ({
  clearPendingOrganizationJoinCookieAction: (...args: unknown[]) =>
    clearPendingOrganizationJoinCookieActionMock(...args),
}));

vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspace: (...args: unknown[]) =>
    activateOrganizationWorkspaceMock(...args),
}));

import { PendingInvitesQueue } from "../pending-invites-queue.client";

const messages = {
  WorkspaceGate: {
    Pending: {
      accept: "Accept",
      join: "Join",
      rejectAll: "Reject all",
      rejectAllHint: "Rejecting every invitation lets you create your own.",
      acceptError: "Accept failed",
      joinError: "Join failed",
      rejectError: "Reject failed",
    },
  },
};

function renderQueue() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PendingInvitesQueue
        items={[
          {
            kind: "invitation",
            id: "inv_1",
            organizationId: "org_1",
            organizationName: "Acme",
          },
          {
            kind: "join",
            token: "join_token_1",
            organizationName: "Join Co",
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

describe("PendingInvitesQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activateOrganizationWorkspaceMock.mockResolvedValue(undefined);
    clearPendingOrganizationJoinCookieActionMock.mockResolvedValue({
      ok: true,
      value: null,
    });
  });

  it("accepts one invitation, activates that org, and leaves the gate", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_1" } },
      error: null,
    });

    renderQueue();
    await user.click(
      screen.getByTestId("workspace-gate-accept-invitation-inv_1"),
    );

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalledWith({
        invitationId: "inv_1",
      });
    });
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith("org_1");
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalled();
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
    expect(acceptOrganizationInviteLinkMock).not.toHaveBeenCalled();
  });

  it("joins via the recovered link and leaves the gate", async () => {
    const user = userEvent.setup();
    acceptOrganizationInviteLinkMock.mockResolvedValue({
      ok: true,
      value: { organizationId: "org_join", organizationSlug: "join-co" },
    });

    renderQueue();
    await user.click(
      screen.getByTestId("workspace-gate-accept-join-join_token_1"),
    );

    await waitFor(() => {
      expect(acceptOrganizationInviteLinkMock).toHaveBeenCalledWith({
        token: "join_token_1",
      });
    });
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith("org_join");
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });

  it("rejects every invitation and stays on the gate", async () => {
    const user = userEvent.setup();
    rejectInvitationMock.mockResolvedValue({ error: null });

    renderQueue();
    await user.click(screen.getByTestId("workspace-gate-reject-all"));

    await waitFor(() => {
      expect(rejectInvitationMock).toHaveBeenCalledWith({
        invitationId: "inv_1",
      });
    });
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalled();
    expect(routerRefreshMock).toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
  });

  it("stays on the queue and toasts when accept fails", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: null,
      error: { message: "seat full" },
    });

    renderQueue();
    await user.click(
      screen.getByTestId("workspace-gate-accept-invitation-inv_1"),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("seat full");
    });
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
  });
});
