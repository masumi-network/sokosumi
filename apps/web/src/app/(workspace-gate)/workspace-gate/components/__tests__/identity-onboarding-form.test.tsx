import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceGateErrorCode } from "@/lib/actions/errors";

const toastErrorMock = vi.fn();
const updateUserMock = vi.fn();
const createPersonalWorkspaceActionMock = vi.fn();
const activateOrganizationWorkspaceMock = vi.fn();
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
    updateUser: (...args: unknown[]) => updateUserMock(...args),
  },
}));

vi.mock("@/lib/actions/workspace-gate", () => ({
  createPersonalWorkspaceAction: (...args: unknown[]) =>
    createPersonalWorkspaceActionMock(...args),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  activateOrganizationWorkspace: (...args: unknown[]) =>
    activateOrganizationWorkspaceMock(...args),
}));

import { IdentityOnboardingForm } from "../identity-onboarding-form.client";

const messages = {
  Library: {
    Auth: {
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
    Identity: {
      displayNameLabel: "Display name",
      displayNamePlaceholder: "Your name",
      choiceLabel: "How do you want to start?",
      personalTitle: "Personal workspace",
      personalDescription: "Work on your own.",
      organizationTitle: "Organization",
      organizationDescription: "Set up a shared workspace.",
      createPersonal: "Create personal workspace",
      continue: "Continue",
      back: "Back",
      organizationPlaceholderTitle: "Organization setup is next",
      organizationPlaceholderBody: "Not available yet.",
      nameUpdateError: "Name update failed",
      personalCreateError: "Create failed",
      personalAlreadyExists: "Already exists",
    },
  },
};

function renderForm(initialName = "Ada Lovelace") {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <IdentityOnboardingForm initialName={initialName} />
    </NextIntlClientProvider>,
  );
}

describe("IdentityOnboardingForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateUserMock.mockResolvedValue({ error: null });
    createPersonalWorkspaceActionMock.mockResolvedValue({
      ok: true,
      value: { workspaceId: "ws-1" },
    });
    activateOrganizationWorkspaceMock.mockResolvedValue(undefined);
  });

  it("prefills the display name and requires at least 2 characters", async () => {
    const user = userEvent.setup();
    renderForm("A");

    const nameInput = screen.getByTestId("workspace-gate-identity-name");
    expect(nameInput).toHaveValue("A");

    await user.clear(nameInput);
    await user.type(nameInput, "x");
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    expect(
      await screen.findByText("Name must be at least 2 characters"),
    ).toBeTruthy();
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
  });

  it("creates a personal workspace after confirming the name", async () => {
    const user = userEvent.setup();
    renderForm("Ada Lovelace");

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({ name: "Ada Lovelace" });
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith(null);
      expect(routerReplaceMock).toHaveBeenCalledWith("/");
      expect(routerRefreshMock).toHaveBeenCalledOnce();
    });
  });

  it("does not create a personal workspace when Organization is chosen", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    expect(
      await screen.findByTestId("workspace-gate-identity-org-placeholder"),
    ).toBeTruthy();
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("workspace-gate-identity-back"));
    expect(screen.getByTestId("workspace-gate-identity-form")).toBeTruthy();
  });

  it("surfaces Core 409 without pretending success", async () => {
    const user = userEvent.setup();
    createPersonalWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error: {
        code: WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS,
        message: "Personal workspace already exists",
      },
    });
    renderForm();

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Already exists");
    });
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
    expect(routerReplaceMock).not.toHaveBeenCalled();
  });
});
