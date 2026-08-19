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

import type { WorkspaceGateQueueItem } from "@/lib/workspace-gate-queue";

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
      acceptAll: "Accept all",
      acceptSelected: "Accept selected",
      selectItem: "Select {organizationName}",
      batchError: "We could not accept: {names}.",
      rejectAll: "Reject all",
      acceptError: "Accept failed",
      joinError: "Join failed",
      rejectError: "Reject failed",
      activateError: "Could not switch into that organization",
      activateRetry: "Try switching again",
    },
  },
};

const invitationItem: WorkspaceGateQueueItem = {
  kind: "invitation",
  id: "inv_1",
  organizationId: "org_1",
  organizationName: "Acme",
  organizationSlug: "acme",
};
const secondInvitationItem: WorkspaceGateQueueItem = {
  kind: "invitation",
  id: "inv_2",
  organizationId: "org_2",
  organizationName: "Beta",
  organizationSlug: "beta",
};
const joinItem: WorkspaceGateQueueItem = {
  kind: "join",
  token: "join_token_1",
  organizationName: "Join Co",
  organizationSlug: "join-co",
};

function renderQueue(
  initialName = "Ada Lovelace",
  items: WorkspaceGateQueueItem[] = [invitationItem, joinItem],
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <PendingInvitesQueue initialName={initialName} items={items} />
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
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith({
      organizationSlug: "acme",
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
    expect(acceptOrganizationInviteLinkMock).not.toHaveBeenCalled();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("collects a name before accept-all when the user has none", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_1" } },
      error: null,
    });
    acceptOrganizationInviteLinkMock.mockResolvedValue({
      ok: true,
      value: { organizationId: "org_join", organizationSlug: "join-co" },
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
    await user.click(screen.getByTestId("workspace-gate-accept-all"));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ name: "Ada Lovelace" });
    });
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    expect(acceptOrganizationInviteLinkMock).not.toHaveBeenCalled();

    resolveUpdate({ error: null });

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalledWith({
        invitationId: "inv_1",
      });
    });
    expect(acceptOrganizationInviteLinkMock).toHaveBeenCalledWith({
      token: "join_token_1",
    });
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
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith({
      organizationSlug: "join-co",
      acceptedJoinToken: "join_token_1",
    });
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
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith(
      {},
    );
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
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith({
      organizationSlug: "acme",
    });
  });

  it("hides Accept all and row checkboxes on a one-item list", () => {
    renderQueue("Ada Lovelace", [invitationItem]);

    expect(
      screen.queryByTestId("workspace-gate-accept-all"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-gate-accept-selected"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-gate-select-invitation-inv_1"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-gate-accept-invitation-inv_1"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workspace-gate-reject-all")).not.toHaveClass(
      "ml-auto",
    );
  });

  it("puts Reject all on the right of Accept all when more than one invite is pending", () => {
    renderQueue();

    expect(screen.getByTestId("workspace-gate-accept-all")).toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-gate-accept-selected"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("workspace-gate-reject-all")).toHaveClass(
      "ml-auto",
    );
  });

  it("accepts every pending item, activates the first success, and leaves", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_1" } },
      error: null,
    });
    acceptOrganizationInviteLinkMock.mockResolvedValue({
      ok: true,
      value: { organizationId: "org_join", organizationSlug: "join-co" },
    });

    renderQueue();
    await user.click(screen.getByTestId("workspace-gate-accept-all"));

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalledWith({
        invitationId: "inv_1",
      });
    });
    expect(acceptOrganizationInviteLinkMock).toHaveBeenCalledWith({
      token: "join_token_1",
    });
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith("org_1");
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith({
      organizationSlug: "acme",
      acceptedJoinToken: "join_token_1",
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });

  it("keeps Accept selected disabled until a row is checked", async () => {
    const user = userEvent.setup();
    renderQueue();

    expect(screen.getByTestId("workspace-gate-accept-selected")).toBeDisabled();

    await user.click(
      screen.getByTestId("workspace-gate-select-invitation-inv_1"),
    );

    expect(
      screen.getByTestId("workspace-gate-accept-selected"),
    ).not.toBeDisabled();
  });

  it("accepts only the selected rows", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_2" } },
      error: null,
    });

    renderQueue("Ada Lovelace", [
      invitationItem,
      secondInvitationItem,
      joinItem,
    ]);
    await user.click(
      screen.getByTestId("workspace-gate-select-invitation-inv_2"),
    );
    await user.click(screen.getByTestId("workspace-gate-accept-selected"));

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalledWith({
        invitationId: "inv_2",
      });
    });
    expect(acceptInvitationMock).toHaveBeenCalledTimes(1);
    expect(acceptOrganizationInviteLinkMock).not.toHaveBeenCalled();
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith("org_2");
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });

  it("continues the batch after a failure, toasts the failed orgs, and still leaves", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: null,
      error: { message: "seat full" },
    });
    acceptOrganizationInviteLinkMock.mockResolvedValue({
      ok: true,
      value: { organizationId: "org_join", organizationSlug: "join-co" },
    });

    renderQueue();
    await user.click(screen.getByTestId("workspace-gate-accept-all"));

    await waitFor(() => {
      expect(acceptOrganizationInviteLinkMock).toHaveBeenCalledWith({
        token: "join_token_1",
      });
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "We could not accept: Acme (seat full).",
    );
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith("org_join");
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith({
      organizationSlug: "join-co",
      acceptedJoinToken: "join_token_1",
    });
    expect(routerReplaceMock).toHaveBeenCalledWith("/");
  });

  it("stays on the queue when every selected accept fails", async () => {
    const user = userEvent.setup();
    acceptInvitationMock.mockResolvedValue({
      data: null,
      error: { message: "seat full" },
    });
    acceptOrganizationInviteLinkMock.mockResolvedValue({
      ok: false,
      error: { message: "expired" },
    });

    renderQueue();
    await user.click(screen.getByTestId("workspace-gate-accept-all"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "We could not accept: Acme (seat full), Join Co (expired).",
      );
    });
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
    expect(routerRefreshMock).toHaveBeenCalled();
  });
});
