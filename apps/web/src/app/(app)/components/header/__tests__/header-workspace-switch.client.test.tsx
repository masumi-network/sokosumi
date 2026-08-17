import type { SessionUser } from "@sokosumi/utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate";
import { authClient } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";

import HeaderWorkspaceSwitch from "../header-workspace-switch.client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/hooks/use-modal", () => ({
  default: () => ({
    Component: null,
    showModal: vi.fn(),
  }),
}));

vi.mock("@/lib/actions/workspace-gate", () => ({
  createPersonalWorkspaceAction: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    updateUser: vi.fn(),
  },
}));

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

  it("lists create personal instead of a Personal row for org-only users", async () => {
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

    expect(screen.getByText("createPersonalWorkspace")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Test User/ })).toBeNull();
  });

  it("creates and activates personal when the user already has a name", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue({
      ok: true,
      value: { workspaceId: "ws-1" },
    } as never);

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
    await user.click(screen.getByText("createPersonalWorkspace"));

    expect(createPersonalWorkspaceAction).toHaveBeenCalledOnce();
    expect(onSelectWorkspace).toHaveBeenCalledWith(null);
  });

  it("collects a name first when the user has none, then creates and activates", async () => {
    const user = userEvent.setup();
    const onSelectWorkspace = vi.fn();
    const namelessUser: SessionUser = { ...sessionUser, name: "" };
    vi.mocked(createPersonalWorkspaceAction).mockResolvedValue({
      ok: true,
      value: { workspaceId: "ws-1" },
    } as never);
    vi.mocked(authClient.updateUser).mockResolvedValue({
      error: null,
    } as never);

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
    await user.click(screen.getByText("createPersonalWorkspace"));

    expect(createPersonalWorkspaceAction).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox"), "Ada Lovelace");
    await user.click(
      screen.getByRole("button", { name: "createPersonalWorkspace" }),
    );

    await waitFor(() => {
      expect(authClient.updateUser).toHaveBeenCalledWith({
        name: "Ada Lovelace",
      });
    });
    expect(createPersonalWorkspaceAction).toHaveBeenCalledOnce();
    expect(onSelectWorkspace).toHaveBeenCalledWith(null);
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
    expect(
      screen.queryByText("createPersonalWorkspace"),
    ).not.toBeInTheDocument();
  });
});
