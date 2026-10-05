import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JoinActions } from "./join-actions";

const acceptOrganizationInviteLinkMock = vi.fn();
const updateUserMock = vi.fn();
const activateOrganizationWorkspaceMock = vi.fn();
const clearPendingOrganizationJoinCookieActionMock = vi.fn();
const routerPushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: (...args: unknown[]) => updateUserMock(...args),
    getSession: async () => ({ data: { user: { name: "" } }, error: null }),
  },
}));

vi.mock("@/lib/actions/organization/invite-link-action", () => ({
  acceptOrganizationInviteLink: (...args: unknown[]) =>
    acceptOrganizationInviteLinkMock(...args),
}));

vi.mock("@/lib/actions/workspace-gate/action", () => ({
  clearPendingOrganizationJoinCookieAction: (...args: unknown[]) =>
    clearPendingOrganizationJoinCookieActionMock(...args),
}));

vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspaceWithRetry: (...args: unknown[]) =>
    activateOrganizationWorkspaceMock(...args),
}));

const messages = {
  Library: {
    Auth: {
      NameField: {
        firstNameLabel: "First name",
        lastNameLabel: "Last name",
        persistError: "Name update failed",
      },
      Schema: {
        FirstName: {
          required: "First name is required",
          max: "First name is too long",
        },
        LastName: {
          required: "Last name is required",
          max: "Last name is too long",
        },
      },
    },
  },
  Join: {
    join: "Join {organization}",
    joining: "Joining",
    signIn: "Log in",
    register: "Register",
    decline: "Decline",
    activateRetry: "Try switching again",
    signedOutHint: "Log in to join",
    Error: {
      joinFailed: "Join failed",
      declineFailed: "Decline failed",
      activateFailed: "Could not switch into that organization",
    },
  },
};

function renderJoin(
  currentUserName: string,
  currentUserFirstName?: string | null,
  currentUserLastName?: string | null,
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <JoinActions
        token="join_token_1"
        organizationName="Join Co"
        organizationSlug="join-co"
        isAuthenticated={true}
        currentUserName={currentUserName}
        currentUserFirstName={currentUserFirstName}
        currentUserLastName={currentUserLastName}
      />
    </NextIntlClientProvider>,
  );
}

describe("JoinActions name collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
    acceptOrganizationInviteLinkMock.mockResolvedValue({
      ok: true,
      value: { organizationId: "org_join" },
    });
    activateOrganizationWorkspaceMock.mockResolvedValue(true);
    clearPendingOrganizationJoinCookieActionMock.mockResolvedValue({
      ok: true,
      value: null,
    });
  });

  it("prefills and collects missing OAuth parts without replacing the provider name", async () => {
    const user = userEvent.setup();
    renderJoin("Countess of Lovelace", "Ada", "");
    expect(screen.getByTestId("collect-user-first-name")).toHaveValue("Ada");
    await user.click(screen.getByRole("button", { name: "Join Join Co" }));
    expect(await screen.findByText("Last name is required")).toBeTruthy();
    expect(acceptOrganizationInviteLinkMock).not.toHaveBeenCalled();

    await user.type(screen.getByTestId("collect-user-last-name"), "Lovelace");
    await user.click(screen.getByRole("button", { name: "Join Join Co" }));

    await waitFor(() =>
      expect(acceptOrganizationInviteLinkMock).toHaveBeenCalled(),
    );
    expect(updateUserMock).toHaveBeenCalledWith({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("collects a name before join when the user has none", async () => {
    const user = userEvent.setup();
    let resolveUpdate: (value: { error: null }) => void = () => {};
    updateUserMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderJoin("");

    await user.type(screen.getByTestId("collect-user-first-name"), "Ada");
    await user.type(screen.getByTestId("collect-user-last-name"), "Lovelace");
    await user.click(screen.getByRole("button", { name: /Join Join Co/ }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({
        firstName: "Ada",
        lastName: "Lovelace",
        name: "Ada Lovelace",
      });
    });
    expect(acceptOrganizationInviteLinkMock).not.toHaveBeenCalled();

    resolveUpdate({ error: null });

    await waitFor(() => {
      expect(acceptOrganizationInviteLinkMock).toHaveBeenCalledWith({
        token: "join_token_1",
      });
    });
  });

  it("skips the name field when the user already has one", async () => {
    const user = userEvent.setup();
    renderJoin("Ada Lovelace");

    expect(
      screen.queryByTestId("collect-user-first-name"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Join Join Co/ }));

    await waitFor(() => {
      expect(acceptOrganizationInviteLinkMock).toHaveBeenCalled();
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("clears the join cookie and opens setup when declined", async () => {
    const user = userEvent.setup();
    renderJoin("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() => {
      expect(
        clearPendingOrganizationJoinCookieActionMock,
      ).toHaveBeenCalledOnce();
    });
    expect(acceptOrganizationInviteLinkMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith("/setup");
  });

  it("does not navigate and offers retry when organization activation fails", async () => {
    const user = userEvent.setup();
    activateOrganizationWorkspaceMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderJoin("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: /Join Join Co/ }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Could not switch into that organization",
      );
    });
    expect(routerPushMock).not.toHaveBeenCalled();
    expect(clearPendingOrganizationJoinCookieActionMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("join-retry-activation"));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/organizations/join-co");
    });
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith({
      organizationSlug: "join-co",
      acceptedJoinToken: "join_token_1",
    });
  });
});
