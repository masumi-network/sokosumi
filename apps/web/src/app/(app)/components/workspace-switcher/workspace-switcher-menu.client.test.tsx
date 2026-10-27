import type { UserWorkspace } from "@sokosumi/core-client";
import type { SessionUser } from "@sokosumi/utils";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors/error-codes/workspace-gate";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate/action";
import { authClient } from "@/lib/auth/auth.client";

import { WorkspaceSwitcherProvider } from "./workspace-switcher.client";
import WorkspaceSwitcherMenu from "./workspace-switcher-menu.client";

const mocks = vi.hoisted(() => ({
  showCreateOrganizationModal: vi.fn(),
  handleSelectWorkspace: vi.fn(),
  isPending: false,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-modal", () => ({
  default: () => ({
    Component: null,
    showModal: mocks.showCreateOrganizationModal,
  }),
}));

vi.mock("@/lib/actions/workspace-gate/action", () => ({
  createPersonalWorkspaceAction: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: vi.fn(),
  },
  useSession: () => ({ data: null }),
}));

vi.mock("@/app/components/user-avatar/workspace-switcher", () => ({
  useWorkspaceSwitcher: () => ({
    isPending: mocks.isPending,
    handleSelectWorkspace: mocks.handleSelectWorkspace,
  }),
}));

const createdPersonalWorkspace = {
  ok: true as const,
  value: { workspaceId: "ws-1" },
} satisfies Awaited<ReturnType<typeof createPersonalWorkspaceAction>>;

const sessionUser: SessionUser = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  emailVerified: true,
  image: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  termsAccepted: true,
  marketingOptIn: false,
};

const personalWorkspace: UserWorkspace = {
  id: "ws-p",
  kind: "personal",
  name: "Personal",
  organizationId: null,
  slug: null,
  logo: null,
  websiteUrl: null,
  preferred: false,
  enabledSocialProviders: [],
};

const orgWorkspace: UserWorkspace = {
  id: "ws-a",
  kind: "organization",
  name: "Org A",
  organizationId: "org-a",
  slug: "org-a",
  logo: null,
  websiteUrl: null,
  preferred: false,
  enabledSocialProviders: ["x", "youtube", "linkedin"],
};

function renderSwitcher({
  workspaces,
  activeOrganizationId,
  user = sessionUser,
}: {
  workspaces: UserWorkspace[];
  activeOrganizationId: string | null;
  user?: SessionUser;
}) {
  return render(
    <WorkspaceSwitcherProvider
      sessionUser={user}
      workspaces={workspaces}
      activeOrganizationId={activeOrganizationId}
    >
      <WorkspaceSwitcherMenu placement="sidebar" />
    </WorkspaceSwitcherProvider>,
  );
}

describe("WorkspaceSwitcherMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPending = false;
  });

  it("skeletons the chip when the active org is missing from the workspaces", () => {
    renderSwitcher({
      workspaces: [personalWorkspace],
      activeOrganizationId: "org-a",
    });

    expect(screen.queryByText("Test User")).not.toBeInTheDocument();
    expect(screen.queryByText("Org A")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-switcher-skeleton"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "switchWorkspace" }),
    ).toBeInTheDocument();
  });

  it("shows personal workspace from session when no org is active", () => {
    renderSwitcher({
      workspaces: [personalWorkspace],
      activeOrganizationId: null,
    });

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("shows the active org from the workspaces", () => {
    renderSwitcher({
      workspaces: [personalWorkspace, orgWorkspace],
      activeOrganizationId: "org-a",
    });

    expect(screen.getByText("Org A")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-skeleton"),
    ).not.toBeInTheDocument();
  });

  // The sidebar header's row, as in Linear.
  it("leads with the avatar, then the name shortened to fit, then the chevron", () => {
    renderSwitcher({
      workspaces: [personalWorkspace, orgWorkspace],
      activeOrganizationId: "org-a",
    });

    const trigger = screen.getByRole("button", { name: "Org A" });
    const avatar = trigger.querySelector('span[aria-hidden="true"]');
    const name = within(trigger).getByText("Org A");
    const chevron = trigger.querySelector(".lucide-chevron-down");

    if (!avatar || !chevron) throw new Error("no avatar or chevron");
    expect(
      avatar.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      name.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(name.className.split(/\s+/)).toEqual(
      expect.arrayContaining(["min-w-0", "truncate"]),
    );
  });

  it("does not treat a null org session as personal when no personal workspace exists", () => {
    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: null,
    });

    expect(screen.queryByText("Test User")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-switcher-skeleton"),
    ).toBeInTheDocument();
  });

  // One workspace still opens the menu: Create workspace lives there.
  it("lists one create workspace action instead of split create rows", async () => {
    const user = userEvent.setup();
    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));

    expect(screen.getByText("createWorkspace")).toBeInTheDocument();
    expect(screen.queryByText("createPersonalWorkspace")).toBeNull();
    expect(screen.queryByText("createOrganization")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Test User/ })).toBeNull();
  });

  it("switches to the workspace picked from the menu", async () => {
    const user = userEvent.setup();
    renderSwitcher({
      workspaces: [personalWorkspace, orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByRole("menuitem", { name: /Test User/ }));

    expect(mocks.handleSelectWorkspace).toHaveBeenCalledWith(null);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("creates and activates personal after choosing Personal and Continue", async () => {
    const user = userEvent.setup();
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue(
      createdPersonalWorkspace,
    );

    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));
    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(createPersonalWorkspaceAction).toHaveBeenCalledOnce();
    });
    expect(mocks.handleSelectWorkspace).toHaveBeenCalledWith(null);
    expect(mocks.showCreateOrganizationModal).not.toHaveBeenCalled();
    expect(authClient.updateUser).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("workspace-switcher-create-choice"),
    ).not.toBeInTheDocument();
  });

  it("toasts and keeps the choice dialog open when personal create fails", async () => {
    const user = userEvent.setup();
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue({
      ok: false,
      error: {
        code: WorkspaceGateErrorCode.LAST_WORKSPACE,
      },
    } satisfies Awaited<ReturnType<typeof createPersonalWorkspaceAction>>);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));
    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("personalCreateError");
    });
    expect(mocks.handleSelectWorkspace).not.toHaveBeenCalled();
    expect(mocks.showCreateOrganizationModal).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("workspace-switcher-create-choice"),
    ).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it("opens the organization wizard after choosing Organization and Continue", async () => {
    const user = userEvent.setup();
    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));

    expect(screen.getByText("personalTitle")).toBeInTheDocument();
    expect(screen.getByText("organizationTitle")).toBeInTheDocument();
    expect(screen.getByText("choiceHint")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /organizationTitle/ }));
    await user.click(screen.getByRole("button", { name: "continue" }));

    expect(mocks.showCreateOrganizationModal).toHaveBeenCalledOnce();
    expect(createPersonalWorkspaceAction).not.toHaveBeenCalled();
  });

  it("toasts when create succeeds but activation throws", async () => {
    const user = userEvent.setup();
    mocks.handleSelectWorkspace.mockRejectedValue(
      new Error("setActive failed"),
    );
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue(
      createdPersonalWorkspace,
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));
    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("personalActivateError");
    });
    expect(createPersonalWorkspaceAction).toHaveBeenCalledOnce();
    consoleErrorSpy.mockRestore();
  });

  it("creates personal without a name dialog when the user has no name", async () => {
    const user = userEvent.setup();
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue(
      createdPersonalWorkspace,
    );

    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: "org-a",
      user: { ...sessionUser, name: "" },
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));

    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(createPersonalWorkspaceAction).toHaveBeenCalledOnce();
    });
    expect(authClient.updateUser).not.toHaveBeenCalled();
    expect(mocks.handleSelectWorkspace).toHaveBeenCalledWith(null);
  });

  it("toasts when the workspace already exists and activation throws", async () => {
    const user = userEvent.setup();
    mocks.handleSelectWorkspace.mockRejectedValue(
      new Error("setActive failed"),
    );
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue({
      ok: false,
      error: {
        code: WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS,
      },
    } satisfies Awaited<ReturnType<typeof createPersonalWorkspaceAction>>);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    renderSwitcher({
      workspaces: [orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));
    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("personalActivateError");
    });
    expect(mocks.handleSelectWorkspace).toHaveBeenCalledWith(null);
    consoleErrorSpy.mockRestore();
  });

  it("lists personal and org workspaces when both exist", async () => {
    const user = userEvent.setup();
    renderSwitcher({
      workspaces: [personalWorkspace, orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getAllByText("Org A").length).toBeGreaterThan(0);
    expect(screen.getByText("createWorkspace")).toBeInTheDocument();
    expect(screen.queryByText("createPersonalWorkspace")).toBeNull();
    expect(screen.queryByText("createOrganization")).toBeNull();
  });

  it("opens the organization wizard directly when a personal workspace already exists", async () => {
    const user = userEvent.setup();
    renderSwitcher({
      workspaces: [personalWorkspace, orgWorkspace],
      activeOrganizationId: "org-a",
    });

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));

    expect(mocks.showCreateOrganizationModal).toHaveBeenCalledOnce();
    expect(createPersonalWorkspaceAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId("workspace-switcher-create-choice")).toBeNull();
  });
});
