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

const updateUserMock = vi.fn();

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: (...args: unknown[]) => updateUserMock(...args),
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
  activateOrganizationWorkspaceWithRetry: (...args: unknown[]) =>
    activateOrganizationWorkspaceMock(...args),
}));

import { PendingInvitesQueue } from "../pending-invites-queue.client";

const messages = {
  Library: {
    Auth: {
      NameField: {
        label: "Name",
        placeholder: "Your name",
        persistError: "Name update failed",
      },
      Schema: {
        Name: {
          invalid: "Invalid name",
          required: "Name is required",
          min: "Name must be at least 2 characters",
          max: "Name is too long",
        },
      },
    },
  },
  WorkspaceGate: {
    Pending: {
      accept: "Accept",
      join: "Join",
      rejectAll: "Reject all",
      rejectAllHint: "Rejecting every invitation lets you create your own.",
      acceptError: "Accept failed",
      joinError: "Join failed",
      rejectError: "Reject failed",
      activateError: "Could not switch into that organization",
      activateRetry: "Try switching again",
    },
  },
};

function renderQueue(initialName = "Ada Lovelace") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PendingInvitesQueue
        initialName={initialName}
        items={[
          {
            kind: "invitation",
            id: "inv_1",
            organizationId: "org_1",
            organizationName: "Acme",
            organizationSlug: "acme",
          },
          {
            kind: "join",
            token: "join_token_1",
            organizationName: "Join Co",
            organizationSlug: "join-co",
          },
        ]}
      />
    </NextIntlClientProvider>,
  );
}

describe("PendingInvitesQueue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
    activateOrganizationWorkspaceMock.mockResolvedValue(true);
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
    expect(screen.getByText("acme")).toBeInTheDocument();
    expect(screen.getByText("join-co")).toBeInTheDocument();
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
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("collects a name before accepting when the user has none", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_1" } },
      error: null,
    });
    let resolveUpdate: (value: { error: null }) => void = () => {};
    updateUserMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderQueue("");
    await user.type(screen.getByTestId("collect-user-name"), "Ada Lovelace");
    await user.click(
      screen.getByTestId("workspace-gate-accept-invitation-inv_1"),
    );

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ name: "Ada Lovelace" });
    });
    expect(acceptInvitationMock).not.toHaveBeenCalled();

    resolveUpdate({ error: null });

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalledWith({
        invitationId: "inv_1",
      });
    });
  });

  it("does not accept when the nameless user submits no name", async () => {
    const user = userEvent.setup();
    renderQueue("");
    await user.click(
      screen.getByTestId("workspace-gate-accept-invitation-inv_1"),
    );

    await waitFor(() => {
      expect(screen.getByText("Name is required")).toBeInTheDocument();
    });
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
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

  it("stays on the queue and offers retry when organization activation fails", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_1" } },
      error: null,
    });
    activateOrganizationWorkspaceMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    renderQueue();
    await user.click(
      screen.getByTestId("workspace-gate-accept-invitation-inv_1"),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Could not switch into that organization",
      );
    });
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(clearPendingOrganizationJoinCookieActionMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("workspace-gate-retry-activation"));

    await waitFor(() => {
      expect(routerReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalled();
  });
});
