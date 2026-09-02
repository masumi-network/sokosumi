import type { SessionUser } from "@sokosumi/utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate";
import { authClient } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

import HeaderWorkspaceSwitch from "./header-workspace-switch.client";

const { showCreateOrganizationModal } = vi.hoisted(() => ({
  showCreateOrganizationModal: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-modal", () => ({
  default: () => ({
    Component: null,
    showModal: showCreateOrganizationModal,
  }),
}));

vi.mock("@/lib/actions/workspace-gate", () => ({
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

const orgMember: MemberWithOrganization = {
  id: "member-1",
  organizationId: "org-a",
  userId: "user-1",
  role: "member",
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  seatAssignedAt: null,
  organization: {
    id: "org-a",
    name: "Org A",
    slug: "org-a",
    logo: null,
    metadata: null,
    stripeCustomerId: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  },
};

describe("HeaderWorkspaceSwitch last-known members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skeletons the chip when active org is missing from cached members", () => {
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[]}
        hasPersonalWorkspace={true}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

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
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[]}
        hasPersonalWorkspace={true}
        activeOrganizationId={null}
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("shows the matching last-known org when members include it", () => {
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={true}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.getByText("Org A")).toBeInTheDocument();
    expect(
      screen.queryByTestId("workspace-switcher-skeleton"),
    ).not.toBeInTheDocument();
  });

  it("does not treat a null org session as personal when no personal workspace exists", () => {
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId={null}
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    expect(screen.queryByText("Test User")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("workspace-switcher-skeleton"),
    ).toBeInTheDocument();
  });

  it("lists one create workspace action instead of split create rows", async () => {
    const user = userEvent.setup();
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));

    expect(screen.getByText("createWorkspace")).toBeInTheDocument();
    expect(screen.queryByText("createPersonalWorkspace")).toBeNull();
    expect(screen.queryByText("createOrganization")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Test User/ })).toBeNull();
  });

  it("creates and activates personal after choosing Personal and Continue", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue(
      createdPersonalWorkspace,
    );

    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));
    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(createPersonalWorkspaceAction).toHaveBeenCalledOnce();
    });
    expect(onSelectWorkspace).toHaveBeenCalledWith(null);
    expect(showCreateOrganizationModal).not.toHaveBeenCalled();
    expect(authClient.updateUser).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("workspace-switcher-create-choice"),
    ).not.toBeInTheDocument();
  });

  it("toasts and keeps the choice dialog open when personal create fails", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue({
      ok: false,
      error: {
        code: WorkspaceGateErrorCode.LAST_WORKSPACE,
      },
    } satisfies Awaited<ReturnType<typeof createPersonalWorkspaceAction>>);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));
    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("personalCreateError");
    });
    expect(onSelectWorkspace).not.toHaveBeenCalled();
    expect(showCreateOrganizationModal).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("workspace-switcher-create-choice"),
    ).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  it("opens the organization wizard after choosing Organization and Continue", async () => {
    const user = userEvent.setup();
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));

    expect(screen.getByText("personalTitle")).toBeInTheDocument();
    expect(screen.getByText("organizationTitle")).toBeInTheDocument();
    expect(screen.getByText("choiceHint")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /organizationTitle/ }));
    await user.click(screen.getByRole("button", { name: "continue" }));

    expect(showCreateOrganizationModal).toHaveBeenCalledOnce();
    expect(createPersonalWorkspaceAction).not.toHaveBeenCalled();
  });

  it("toasts when create succeeds but activation throws", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi
      .fn()
      .mockRejectedValue(new Error("setActive failed"));
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue(
      createdPersonalWorkspace,
    );
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

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
    const onSelectWorkspace = vi.fn();
    const namelessUser: SessionUser = { ...sessionUser, name: "" };
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue(
      createdPersonalWorkspace,
    );

    render(
      <HeaderWorkspaceSwitch
        sessionUser={namelessUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));

    expect(screen.queryByRole("textbox")).toBeNull();

    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(createPersonalWorkspaceAction).toHaveBeenCalledOnce();
    });
    expect(authClient.updateUser).not.toHaveBeenCalled();
    expect(onSelectWorkspace).toHaveBeenCalledWith(null);
  });

  it("toasts when the workspace already exists and activation throws", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi
      .fn()
      .mockRejectedValue(new Error("setActive failed"));
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue({
      ok: false,
      error: {
        code: WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS,
      },
    } satisfies Awaited<ReturnType<typeof createPersonalWorkspaceAction>>);
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={false}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={onSelectWorkspace}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));
    await user.click(screen.getByRole("button", { name: "continue" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("personalActivateError");
    });
    expect(onSelectWorkspace).toHaveBeenCalledWith(null);
    consoleErrorSpy.mockRestore();
  });

  it("lists personal and org workspaces when both exist", async () => {
    const user = userEvent.setup();
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={true}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));

    expect(screen.getByText("Test User")).toBeInTheDocument();
    expect(screen.getAllByText("Org A").length).toBeGreaterThan(0);
    expect(screen.getByText("createWorkspace")).toBeInTheDocument();
    expect(screen.queryByText("createPersonalWorkspace")).toBeNull();
    expect(screen.queryByText("createOrganization")).toBeNull();
  });

  it("opens the organization wizard directly when a personal workspace already exists", async () => {
    const user = userEvent.setup();
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={true}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Org A/i }));
    await user.click(screen.getByText("createWorkspace"));

    expect(showCreateOrganizationModal).toHaveBeenCalledOnce();
    expect(createPersonalWorkspaceAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId("workspace-switcher-create-choice")).toBeNull();
  });

  it("renders a row-layout trigger for full-width sections", () => {
    render(
      <HeaderWorkspaceSwitch
        sessionUser={sessionUser}
        members={[orgMember]}
        hasPersonalWorkspace={true}
        activeOrganizationId="org-a"
        isPending={false}
        onSelectWorkspace={vi.fn()}
        layout="row"
      />,
    );

    const trigger = screen.getByTestId("you-workspace-switch");
    expect(trigger).toBeInTheDocument();
    expect(trigger.className).toContain("w-full");
    expect(screen.getByText("Org A")).toBeInTheDocument();
    expect(screen.queryByText("test@example.com")).not.toBeInTheDocument();
  });
});
