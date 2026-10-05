import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleSelectWorkspaceMock = vi.fn();
const createOrganizationWorkspaceActionMock = vi.fn();
const organizationUpdateMock = vi.fn();
const resolveOrganizationSiteIconMock = vi.fn();
const createOrganizationInviteLinkMock = vi.fn();
const onOrganizationReadyMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: false,
    handleSelectWorkspace: (...args: unknown[]) =>
      handleSelectWorkspaceMock(...args),
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/design-md/use-design-md-generation", () => ({
  useDesignMdGeneration: () => ({
    status: "idle",
    generate: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/lib/actions/organization/action", () => ({
  createOrganizationWorkspaceAction: (...args: unknown[]) =>
    createOrganizationWorkspaceActionMock(...args),
  inviteOrganizationMembersBulk: vi.fn(),
}));
vi.mock("@/lib/actions/organization/invite-link-action", () => ({
  createOrganizationInviteLink: (...args: unknown[]) =>
    createOrganizationInviteLinkMock(...args),
}));
vi.mock("@/lib/actions/organization/site-icon-action", () => ({
  resolveOrganizationSiteIcon: (...args: unknown[]) =>
    resolveOrganizationSiteIconMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      update: (...args: unknown[]) => organizationUpdateMock(...args),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { CreateOrganizationWizard } from "./create-organization-wizard";

function WizardHarness({
  onOrganizationReady,
}: {
  onOrganizationReady?: (organizationId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <CreateOrganizationWizard
      open={open}
      onOpenChange={setOpen}
      onOrganizationReady={onOrganizationReady}
    />
  );
}

describe("CreateOrganizationWizard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createOrganizationWorkspaceActionMock.mockResolvedValue({
      ok: true,
      value: { organizationId: "org-1" },
    });
    organizationUpdateMock.mockResolvedValue({ error: null });
    resolveOrganizationSiteIconMock.mockResolvedValue({
      ok: false,
    });
    createOrganizationInviteLinkMock.mockResolvedValue({
      ok: false,
    });
  });

  it("does not complete when dismissed before create", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.click(screen.getByTestId("create-org-wizard-back"));

    expect(onOrganizationReadyMock).not.toHaveBeenCalled();
    expect(createOrganizationWorkspaceActionMock).not.toHaveBeenCalled();
    expect(handleSelectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("creates the organization on name + URL and completes on Finish", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledWith({
      name: "Acme",
      websiteUrl: "https://acme.com/",
    });

    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finish/i }));

    expect(onOrganizationReadyMock).toHaveBeenCalledWith("org-1");
    expect(handleSelectWorkspaceMock).not.toHaveBeenCalled();
  });

  it.each(["Close", "Finish"])(
    "selects and closes via %s without onOrganizationReady, even while selection is pending",
    async (method) => {
      const user = userEvent.setup();
      handleSelectWorkspaceMock.mockReturnValue(new Promise<void>(() => {}));
      render(<WizardHarness />);

      await user.type(
        screen.getByPlaceholderText("Details.namePlaceholder"),
        "Acme",
      );
      await user.type(
        screen.getByPlaceholderText("Details.urlPlaceholder"),
        "acme.com",
      );
      await user.click(screen.getByRole("button", { name: /Nav.next/i }));

      await waitFor(() => {
        expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
      });

      if (method === "Finish") {
        await user.click(screen.getByRole("button", { name: /Nav.next/i }));
        await user.click(
          screen.getByRole("button", { name: /Nav.finishSetup/i }),
        );
        await user.click(screen.getByRole("button", { name: /Nav.finish$/i }));
      } else {
        await user.click(screen.getByRole("button", { name: /close/i }));
      }

      expect(handleSelectWorkspaceMock).toHaveBeenCalledWith("org-1", {
        shouldRedirectAgentJobsBasePath: false,
      });
      expect(onOrganizationReadyMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("completes the created organization when the dialog is dismissed after step 0", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(onOrganizationReadyMock).toHaveBeenCalledWith("org-1");
  });

  it("stays open on Finish while onOrganizationReady leaves", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finish/i }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Nav.finish/i })).toBeDisabled();

    await user.keyboard("{Escape}");

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(onOrganizationReadyMock).toHaveBeenCalledOnce();
  });

  it("shows the ready step while leaving when dismissed after create", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Nav.finish/i })).toBeDisabled();
  });

  it("lets logo and brand steps advance empty", async () => {
    const user = userEvent.setup();
    render(<WizardHarness onOrganizationReady={onOrganizationReadyMock} />);

    await user.type(
      screen.getByPlaceholderText("Details.namePlaceholder"),
      "Acme",
    );
    await user.type(
      screen.getByPlaceholderText("Details.urlPlaceholder"),
      "acme.com",
    );
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));

    await waitFor(() => {
      expect(createOrganizationWorkspaceActionMock).toHaveBeenCalledOnce();
    });

    expect(screen.getByText("Logo.title")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    expect(screen.getByText("Brand.title")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
    expect(screen.getByText("Invite.title")).toBeTruthy();
  });
});
