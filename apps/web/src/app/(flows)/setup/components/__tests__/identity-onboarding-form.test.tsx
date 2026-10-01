import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceGateErrorCode } from "@/lib/actions/errors/error-codes/workspace-gate";

const toastErrorMock = vi.fn();
const updateUserMock = vi.fn();
let storedName = "";
const createPersonalWorkspaceActionMock = vi.fn();
const activateOrganizationWorkspaceMock = vi.fn();
const locationReplaceMock = vi.fn();

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: (...args: unknown[]) => updateUserMock(...args),
    getSession: async () => ({
      data: { user: { name: storedName } },
      error: null,
    }),
  },
}));

vi.mock("@/lib/actions/workspace-gate/action", () => ({
  createPersonalWorkspaceAction: (...args: unknown[]) =>
    createPersonalWorkspaceActionMock(...args),
}));

vi.mock("@/lib/activate-organization-workspace", () => ({
  activateOrganizationWorkspace: (...args: unknown[]) =>
    activateOrganizationWorkspaceMock(...args),
}));

vi.mock(
  "@/components/organizations/create-organization-wizard/create-organization-wizard",
  () => ({
    CreateOrganizationWizard: ({
      open,
      onOpenChange,
      onOrganizationReady,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      onOrganizationReady?: (organizationId: string) => void;
    }) =>
      open ? (
        <div data-testid="create-org-wizard">
          <button
            type="button"
            data-testid="wizard-back"
            onClick={() => onOpenChange(false)}
          >
            wizard back
          </button>
          <button
            type="button"
            data-testid="wizard-complete"
            // The real wizard stays open after handing off, until navigation.
            onClick={() => onOrganizationReady?.("org-1")}
          >
            wizard complete
          </button>
        </div>
      ) : null,
  }),
);

import { IdentityOnboardingForm } from "../identity-onboarding-form.client";

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
  WorkspaceGate: {
    Identity: {
      choiceLabel: "How do you want to work?",
      choiceHint: "You can add another workspace at any time.",
      personalTitle: "Personal",
      personalDescription: "Work on your own.",
      organizationTitle: "Organization",
      organizationDescription: "Work with your team.",
      continue: "Continue",
      nameUpdateError: "Name update failed",
      personalCreateError: "Create failed",
      organizationActivateError: "Could not switch into that organization",
    },
  },
};

const ADA = {
  initialName: "Ada Lovelace",
  initialFirstName: "Ada",
  initialLastName: "Lovelace",
  askName: false,
  returnUrl: "/",
};

// The page the app frame sent a new user here from, query included.
const CHAT_INVITE = "/chat/join/abc?ref=mail";

// An older account: a display name, but only one of the two parts.
const ADA_WITHOUT_LAST_NAME = {
  initialFirstName: "Ada",
  initialLastName: "",
  askName: true,
};

function renderForm(
  props: Partial<Parameters<typeof IdentityOnboardingForm>[0]> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <IdentityOnboardingForm {...ADA} workspaceReady={false} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("IdentityOnboardingForm", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    locationReplaceMock.mockReset();
    vi.stubGlobal("location", {
      ...window.location,
      replace: locationReplaceMock,
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    storedName = "";
    updateUserMock.mockImplementation(async (body: { name?: string }) => {
      if (body.name !== undefined) storedName = body.name;
      return { error: null };
    });
    createPersonalWorkspaceActionMock.mockResolvedValue({
      ok: true,
      value: { workspaceId: "ws-1" },
    });
    activateOrganizationWorkspaceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it.each(["personal", "organization"])(
    "uses refreshed valid names when cached fields were incomplete: %s",
    async (choice) => {
      const user = userEvent.setup();
      const view = renderForm(ADA_WITHOUT_LAST_NAME);
      view.rerender(
        <NextIntlClientProvider locale="en" messages={messages}>
          <IdentityOnboardingForm {...ADA} workspaceReady={false} />
        </NextIntlClientProvider>,
      );

      expect(
        screen.queryByTestId("workspace-gate-identity-last-name"),
      ).toBeNull();
      if (choice === "organization") {
        await user.click(screen.getByRole("radio", { name: /Organization/i }));
      }
      await user.click(screen.getByTestId("workspace-gate-identity-submit"));

      if (choice === "organization") {
        expect(await screen.findByTestId("create-org-wizard")).toBeTruthy();
        expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
      } else {
        await waitFor(() => {
          expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
          expect(locationReplaceMock).toHaveBeenCalledWith("/");
        });
      }
      expect(updateUserMock).not.toHaveBeenCalled();
    },
  );

  it("uses stored names after returning to the same hidden pair", async () => {
    const user = userEvent.setup();
    const view = renderForm();
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IdentityOnboardingForm
          {...ADA}
          initialLastName=""
          askName
          workspaceReady={false}
        />
      </NextIntlClientProvider>,
    );
    await user.clear(screen.getByTestId("workspace-gate-identity-last-name"));
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IdentityOnboardingForm {...ADA} workspaceReady={false} />
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await waitFor(() =>
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce(),
    );
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("does not overwrite a refreshed stored pair with hidden cached names", async () => {
    const user = userEvent.setup();
    const view = renderForm();
    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IdentityOnboardingForm
          {...ADA}
          initialFirstName="Grace"
          initialLastName="Hopper"
          workspaceReady={false}
        />
      </NextIntlClientProvider>,
    );
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await waitFor(() => {
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("does not ask for a name sign-up already gave", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(
      screen.queryByTestId("workspace-gate-identity-first-name"),
    ).toBeNull();
    expect(
      screen.queryByTestId("workspace-gate-identity-last-name"),
    ).toBeNull();
    expect(screen.queryByText("Ada Lovelace")).toBeNull();

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("opens the organization wizard without a name question", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    expect(await screen.findByTestId("create-org-wizard")).toBeTruthy();
    expect(updateUserMock).not.toHaveBeenCalled();
  });

  it("asks for the name when a name part is missing", () => {
    renderForm(ADA_WITHOUT_LAST_NAME);

    expect(
      screen.getByTestId("workspace-gate-identity-first-name"),
    ).toHaveValue("Ada");
    expect(screen.getByTestId("workspace-gate-identity-last-name")).toHaveValue(
      "",
    );
  });

  it("requires both name parts", async () => {
    const user = userEvent.setup();
    renderForm(ADA_WITHOUT_LAST_NAME);

    const firstName = screen.getByTestId("workspace-gate-identity-first-name");

    await user.clear(firstName);
    await user.type(firstName, "  ");
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    expect(await screen.findByText("First name is required")).toBeTruthy();
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
  });

  it("derives the display name for a user who has none", async () => {
    const user = userEvent.setup();
    renderForm({
      initialName: "",
      initialFirstName: "",
      initialLastName: "",
      askName: true,
    });

    await user.type(
      screen.getByTestId("workspace-gate-identity-first-name"),
      "Ada",
    );
    await user.type(
      screen.getByTestId("workspace-gate-identity-last-name"),
      " Lovelace ",
    );
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({
        firstName: "Ada",
        lastName: "Lovelace",
        name: "Ada Lovelace",
      });
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
    });
  });

  it("creates a personal workspace after confirming the name", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(updateUserMock).not.toHaveBeenCalled();
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith(null);
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("asks a user who has a display name but no name parts, and keeps that display name", async () => {
    const user = userEvent.setup();
    renderForm({
      initialName: "Countess of Lovelace",
      initialFirstName: "",
      initialLastName: "",
      askName: true,
    });

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    expect(await screen.findByText("First name is required")).toBeTruthy();
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();

    await user.type(
      screen.getByTestId("workspace-gate-identity-first-name"),
      "Ada",
    );
    await user.type(
      screen.getByTestId("workspace-gate-identity-last-name"),
      "Lovelace",
    );
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({
        firstName: "Ada",
        lastName: "Lovelace",
      });
    });
  });

  it("keeps the first display name when onboarding is retried", async () => {
    const user = userEvent.setup();
    renderForm({
      initialName: "",
      initialFirstName: "",
      initialLastName: "",
      askName: true,
    });
    createPersonalWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error: { code: "CREATE_FAILED" },
    });
    await user.type(
      screen.getByTestId("workspace-gate-identity-first-name"),
      "Ada",
    );
    const lastName = screen.getByTestId("workspace-gate-identity-last-name");
    await user.type(lastName, "Lovelace");
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Create failed"),
    );

    await user.clear(lastName);
    await user.type(lastName, "Byron");
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenLastCalledWith({
        firstName: "Ada",
        lastName: "Byron",
      });
    });
  });

  it("persists an edited last name and leaves the display name alone", async () => {
    const user = userEvent.setup();
    renderForm(ADA_WITHOUT_LAST_NAME);

    const nameInput = screen.getByTestId("workspace-gate-identity-last-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Byron");
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(updateUserMock).toHaveBeenCalledWith({
        firstName: "Ada",
        lastName: "Byron",
      });
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
    });
  });

  it("lets the user select Organization", async () => {
    const user = userEvent.setup();
    renderForm();

    const organizationChoice = screen.getByRole("radio", {
      name: /Organization/i,
    });
    expect(organizationChoice).not.toBeDisabled();
    expect(screen.queryByText("Currently unavailable")).toBeNull();

    await user.click(organizationChoice);

    expect(organizationChoice).toBeChecked();
  });

  it("does not create a personal workspace when Organization is chosen", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    expect(await screen.findByTestId("create-org-wizard")).toBeTruthy();
    expect(updateUserMock).not.toHaveBeenCalled();
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("wizard-back"));
    expect(screen.getByTestId("workspace-gate-identity-form")).toBeTruthy();
    expect(screen.queryByTestId("create-org-wizard")).toBeNull();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("keeps an edited name after Back from the organization wizard", async () => {
    const user = userEvent.setup();
    renderForm(ADA_WITHOUT_LAST_NAME);

    const nameInput = screen.getByTestId("workspace-gate-identity-last-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Byron");
    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await user.click(screen.getByTestId("wizard-back"));

    expect(screen.getByTestId("workspace-gate-identity-last-name")).toHaveValue(
      "Byron",
    );
  });

  it("does not open the wizard when organization name persist fails", async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({
      error: { message: "Name service down" },
    });
    renderForm(ADA_WITHOUT_LAST_NAME);

    const nameInput = screen.getByTestId("workspace-gate-identity-last-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Byron");
    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Name service down");
    });
    expect(screen.queryByTestId("create-org-wizard")).toBeNull();
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("does not navigate away when the organization wizard opens", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("create-org-wizard")).toBeTruthy();
    });
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("leaves the gate when workspace is already ready and the wizard is closed", async () => {
    renderForm({ workspaceReady: true });

    await waitFor(() => {
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(activateOrganizationWorkspaceMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("workspace-gate-identity-form")).toBeNull();
    expect(screen.getByTestId("workspace-gate-leaving")).toBeTruthy();
  });

  it("ends personal setup where the user was going", async () => {
    const user = userEvent.setup();
    renderForm({ returnUrl: CHAT_INVITE });

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(locationReplaceMock).toHaveBeenCalledWith(CHAT_INVITE);
    });
  });

  it("ends organization setup where the user was going", async () => {
    const user = userEvent.setup();
    renderForm({ returnUrl: CHAT_INVITE });

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await user.click(await screen.findByTestId("wizard-complete"));

    await waitFor(() => {
      expect(locationReplaceMock).toHaveBeenCalledWith(CHAT_INVITE);
    });
  });

  it("leaves an already-ready gate for where the user was going", async () => {
    renderForm({ workspaceReady: true, returnUrl: CHAT_INVITE });

    await waitFor(() => {
      expect(locationReplaceMock).toHaveBeenCalledWith(CHAT_INVITE);
    });
  });

  it("keeps the organization wizard mounted when workspace becomes ready", async () => {
    const user = userEvent.setup();
    const view = renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("create-org-wizard")).toBeTruthy();
    });

    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IdentityOnboardingForm {...ADA} workspaceReady />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId("create-org-wizard")).toBeTruthy();
    expect(screen.queryByTestId("workspace-gate-identity-form")).toBeNull();
    expect(screen.getByTestId("workspace-gate-leaving")).toBeTruthy();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("activates the organization before leaving when the wizard finishes after the gate is ready", async () => {
    const user = userEvent.setup();
    let resolveActivate: () => void = () => {};
    activateOrganizationWorkspaceMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveActivate = resolve;
        }),
    );
    const view = renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("create-org-wizard")).toBeTruthy();
    });

    view.rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <IdentityOnboardingForm {...ADA} workspaceReady />
      </NextIntlClientProvider>,
    );

    await user.click(await screen.findByTestId("wizard-complete"));

    expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith("org-1");
    expect(locationReplaceMock).not.toHaveBeenCalled();

    resolveActivate();

    await waitFor(() => {
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("leaves the gate into the created organization when the wizard is ready", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await user.click(await screen.findByTestId("wizard-complete"));

    await waitFor(() => {
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledOnce();
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith("org-1");
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("workspace-gate-identity-submit")).toBeDisabled();
  });

  it("retries organization activation once before leaving the gate", async () => {
    const user = userEvent.setup();
    activateOrganizationWorkspaceMock
      .mockRejectedValueOnce(new Error("setActive failed"))
      .mockResolvedValueOnce(undefined);
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await user.click(await screen.findByTestId("wizard-complete"));

    await waitFor(() => {
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledTimes(2);
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("toasts and still leaves the gate when organization activation fails twice", async () => {
    const user = userEvent.setup();
    activateOrganizationWorkspaceMock.mockRejectedValue(
      new Error("setActive failed"),
    );
    renderForm();

    await user.click(screen.getByRole("radio", { name: /Organization/i }));
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));
    await user.click(await screen.findByTestId("wizard-complete"));

    await waitFor(() => {
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledTimes(2);
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Could not switch into that organization",
      );
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
  });

  it("does not create when the name update fails", async () => {
    const user = userEvent.setup();
    updateUserMock.mockResolvedValue({
      error: { message: "Name service down" },
    });
    renderForm(ADA_WITHOUT_LAST_NAME);

    const nameInput = screen.getByTestId("workspace-gate-identity-last-name");
    await user.clear(nameInput);
    await user.type(nameInput, "Byron");
    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Name service down");
    });
    expect(createPersonalWorkspaceActionMock).not.toHaveBeenCalled();
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("toasts i18n copy for non-409 create errors instead of raw Core text", async () => {
    const user = userEvent.setup();
    createPersonalWorkspaceActionMock.mockResolvedValue({
      ok: false,
      error: {
        code: "INTERNAL",
        message: "ECONNRESET from core-internal-host:8787",
      },
    });
    renderForm();

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Create failed");
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Identity onboarding personal create failed",
      {
        code: "INTERNAL",
        message: "ECONNRESET from core-internal-host:8787",
      },
    );
    expect(locationReplaceMock).not.toHaveBeenCalled();
  });

  it("leaves the gate when Core reports the personal workspace already exists", async () => {
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
      expect(activateOrganizationWorkspaceMock).toHaveBeenCalledWith(null);
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("still leaves the gate when activation fails after create", async () => {
    const user = userEvent.setup();
    activateOrganizationWorkspaceMock.mockRejectedValue(
      new Error("setActive failed"),
    );
    renderForm();

    await user.click(screen.getByTestId("workspace-gate-identity-submit"));

    await waitFor(() => {
      expect(createPersonalWorkspaceActionMock).toHaveBeenCalledOnce();
      expect(locationReplaceMock).toHaveBeenCalledWith("/");
    });
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
