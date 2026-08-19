import type { SessionUser } from "@sokosumi/utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InvitationActions from "../invitation-actions";

const acceptInvitationMock = vi.fn();
const rejectInvitationMock = vi.fn();
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
    organization: {
      acceptInvitation: (...args: unknown[]) => acceptInvitationMock(...args),
      rejectInvitation: (...args: unknown[]) => rejectInvitationMock(...args),
    },
    signOut: vi.fn(),
  },
}));

vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspaceWithRetry: (...args: unknown[]) =>
    activateOrganizationWorkspaceMock(...args),
}));

vi.mock("@/lib/actions/workspace-gate", () => ({
  clearPendingOrganizationJoinCookieAction: (...args: unknown[]) =>
    clearPendingOrganizationJoinCookieActionMock(...args),
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
  AcceptInvitation: {
    InvitationCard: {
      Actions: {
        accept: "Join {organization}",
        joining: "Joining…",
        decline: "Decline",
        activateRetry: "Try switching again",
        signedOutHint: "Sign in or create an account to accept this invite.",
        signIn: "Sign in to join",
        register: "Create an account",
        emailMismatch: "You are not the invited user.",
        logout: "Logout",
        ignore: "Ignore",
        Success: { accept: "Accepted", decline: "Declined" },
        Error: {
          accept: "Accept failed",
          decline: "Decline failed",
          activate: "Activate failed",
        },
        Errors: { unauthorizedAction: "Login" },
      },
    },
  },
};

const user: SessionUser = {
  id: "user-1",
  name: "",
  email: "ada@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
};

function renderActions(sessionUser: SessionUser | null = user) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <InvitationActions
        invitation={{ id: "inv_1", email: "ada@example.com" }}
        organizationName="Acme"
        organizationSlug="acme"
        user={sessionUser ?? undefined}
      />
    </NextIntlClientProvider>,
  );
}

describe("InvitationActions name collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_1" } },
      error: null,
    });
    rejectInvitationMock.mockResolvedValue({ error: null });
    activateOrganizationWorkspaceMock.mockResolvedValue(true);
    clearPendingOrganizationJoinCookieActionMock.mockResolvedValue({
      ok: true,
      value: null,
    });
  });

  it("collects a name before accept when the user has none", async () => {
    const actor = userEvent.setup();
    let resolveUpdate: (value: { error: null }) => void = () => {};
    updateUserMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    renderActions();

    await actor.type(screen.getByTestId("collect-user-name"), "Ada Lovelace");
    await actor.click(screen.getByRole("button", { name: "Join Acme" }));

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

  it("does not show a name field when the user already has one", async () => {
    const actor = userEvent.setup();
    renderActions({ ...user, name: "Ada Lovelace" });

    expect(screen.queryByTestId("collect-user-name")).not.toBeInTheDocument();
    await actor.click(screen.getByRole("button", { name: "Join Acme" }));

    await waitFor(() => {
      expect(acceptInvitationMock).toHaveBeenCalled();
    });
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(clearPendingOrganizationJoinCookieActionMock).toHaveBeenCalledWith({
      organizationSlug: "acme",
    });
  });

  it("does not navigate and offers retry when activation fails", async () => {
    const { toast } = await import("sonner");
    const actor = userEvent.setup();
    activateOrganizationWorkspaceMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    renderActions({ ...user, name: "Ada Lovelace" });

    await actor.click(screen.getByRole("button", { name: "Join Acme" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("Activate failed");
    });
    expect(routerPushMock).not.toHaveBeenCalled();

    await actor.click(screen.getByTestId("invitation-retry-activation"));

    await waitFor(() => {
      expect(routerPushMock).toHaveBeenCalledWith("/organizations/acme");
    });
    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledTimes(2);
  });
});

describe("InvitationActions join-like layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
    acceptInvitationMock.mockResolvedValue({
      data: { member: { organizationId: "org_1" } },
      error: null,
    });
    rejectInvitationMock.mockResolvedValue({ error: null });
    activateOrganizationWorkspaceMock.mockResolvedValue(true);
  });

  it("stacks primary Accept above outline Decline", () => {
    renderActions({ ...user, name: "Ada Lovelace" });

    const accept = screen.getByRole("button", { name: "Join Acme" });
    const decline = screen.getByRole("button", { name: "Decline" });

    expect(accept.compareDocumentPosition(decline)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(accept.className).toContain("w-full");
    expect(decline.className).toContain("w-full");
  });

  it("shows the join signed-out hint and stacked auth actions", async () => {
    const actor = userEvent.setup();
    window.history.pushState({}, "", "/accept-invitation/inv_1");
    renderActions(null);

    expect(
      screen.getByText("Sign in or create an account to accept this invite."),
    ).toBeVisible();
    expect(
      screen.queryByText(/If you already have an account/i),
    ).not.toBeInTheDocument();

    await actor.click(screen.getByRole("button", { name: "Sign in to join" }));
    const signin = new URL(
      String(routerPushMock.mock.calls.at(-1)?.[0]),
      "http://localhost",
    );
    expect(signin.pathname).toBe("/signin");
    expect(signin.searchParams.get("email")).toBe("ada@example.com");
    expect(signin.searchParams.get("returnUrl")).toBe(
      "/accept-invitation/inv_1",
    );

    await actor.click(
      screen.getByRole("button", { name: "Create an account" }),
    );
    const signup = new URL(
      String(routerPushMock.mock.calls.at(-1)?.[0]),
      "http://localhost",
    );
    expect(signup.pathname).toBe("/signup");
    expect(signup.searchParams.get("email")).toBe("ada@example.com");
    expect(signup.searchParams.get("invitationId")).toBe("inv_1");
    expect(signup.searchParams.get("returnUrl")).toBe(
      "/accept-invitation/inv_1",
    );
  });

  it("rejects the invitation instead of clearing a join cookie", async () => {
    const actor = userEvent.setup();
    renderActions({ ...user, name: "Ada Lovelace" });

    await actor.click(screen.getByRole("button", { name: "Decline" }));

    await waitFor(() => {
      expect(rejectInvitationMock).toHaveBeenCalledWith({
        invitationId: "inv_1",
      });
    });
    expect(acceptInvitationMock).not.toHaveBeenCalled();
    expect(routerPushMock).toHaveBeenCalledWith("/");
  });

  it("keeps email mismatch as invitation-only logout / ignore", () => {
    renderActions({ ...user, email: "other@example.com", name: "Other" });

    expect(screen.getByText("You are not the invited user.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Logout" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Ignore" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Join Acme" }),
    ).not.toBeInTheDocument();
  });
});
