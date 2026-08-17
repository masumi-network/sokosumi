import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleSelectWorkspaceMock = vi.fn();
const generateOrganizationSlugMock = vi.fn();
const organizationCreateMock = vi.fn();
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

vi.mock("@/components/design-md", () => ({
  DESIGN_MD_TRANSLATION_NAMESPACE: "App.DesignMd",
  useDesignMdGeneration: () => ({
    status: "idle",
    generate: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("@/lib/actions", () => ({
  generateOrganizationSlug: (...args: unknown[]) =>
    generateOrganizationSlugMock(...args),
  createOrganizationInviteLink: (...args: unknown[]) =>
    createOrganizationInviteLinkMock(...args),
  inviteOrganizationMembersBulk: vi.fn(),
  resolveOrganizationSiteIcon: (...args: unknown[]) =>
    resolveOrganizationSiteIconMock(...args),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    organization: {
      create: (...args: unknown[]) => organizationCreateMock(...args),
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

import { CreateOrganizationWizard } from "../create-organization-wizard";

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
    generateOrganizationSlugMock.mockResolvedValue({
      ok: true,
      value: "acme",
    });
    organizationCreateMock.mockResolvedValue({
      data: { id: "org-1" },
      error: null,
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
    expect(organizationCreateMock).not.toHaveBeenCalled();
    expect(handleSelectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("creates the organization on name + URL and completes on dismiss", async () => {
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
      expect(organizationCreateMock).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
    await user.click(screen.getByRole("button", { name: /Nav.finish/i }));

    expect(onOrganizationReadyMock).toHaveBeenCalledWith("org-1");
    expect(handleSelectWorkspaceMock).not.toHaveBeenCalled();
  });

  it("activates via the workspace switcher when no onOrganizationReady is provided", async () => {
    const user = userEvent.setup();
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
      expect(organizationCreateMock).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(handleSelectWorkspaceMock).toHaveBeenCalledWith("org-1", {
      shouldRedirectAgentJobsBasePath: false,
    });
    expect(onOrganizationReadyMock).not.toHaveBeenCalled();
  });

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
      expect(organizationCreateMock).toHaveBeenCalledOnce();
    });

    await user.click(screen.getByRole("button", { name: /close/i }));

    expect(onOrganizationReadyMock).toHaveBeenCalledWith("org-1");
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
      expect(organizationCreateMock).toHaveBeenCalledOnce();
    });

    expect(screen.getByText("Logo.title")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Nav.next/i }));
    expect(screen.getByText("Brand.title")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Nav.finishSetup/i }));
    expect(screen.getByText("Invite.title")).toBeTruthy();
  });
});
