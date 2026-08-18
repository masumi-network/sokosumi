import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { JoinActions } from "../join-actions";

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
  Join: {
    join: "Join {organization}",
    joining: "Joining",
    signIn: "Sign in",
    register: "Register",
    decline: "Decline",
    signedOutHint: "Sign in to join",
    Error: { joinFailed: "Join failed", declineFailed: "Decline failed" },
  },
};

function renderJoin(currentUserName: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <JoinActions
        token="join_token_1"
        organizationName="Join Co"
        organizationSlug="join-co"
        isAuthenticated={true}
        currentUserName={currentUserName}
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
    activateOrganizationWorkspaceMock.mockResolvedValue(undefined);
    clearPendingOrganizationJoinCookieActionMock.mockResolvedValue({
      ok: true,
      value: null,
    });
  });

  it("collects a name before join when the user has none", async () => {
    const user = userEvent.setup();
    renderJoin("");

    await user.type(screen.getByTestId("collect-user-name"), "Ada Lovelace");
    await user.click(screen.getByRole("button", { name: /Join Join Co/ }));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ name: "Ada Lovelace" });
    });
    expect(acceptOrganizationInviteLinkMock).toHaveBeenCalledWith({
      token: "join_token_1",
    });
  });

  it("skips the name field when the user already has one", async () => {
    const user = userEvent.setup();
    renderJoin("Ada Lovelace");

    expect(screen.queryByTestId("collect-user-name")).not.toBeInTheDocument();
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
});
