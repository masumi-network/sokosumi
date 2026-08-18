import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionOrRedirectMock = vi.fn();
const getWorkspaceAccessMock = vi.fn();
const getMyPendingOrganizationInvitationsMock = vi.fn();
const getPendingOrganizationJoinTokenMock = vi.fn();
const clearPendingOrganizationJoinTokenMock = vi.fn();
const resolveOrganizationInviteLinkMock = vi.fn();
const getTranslationsMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: (...args: unknown[]) =>
    getSessionOrRedirectMock(...args),
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getWorkspaceAccess: (...args: unknown[]) => getWorkspaceAccessMock(...args),
  },
  organizationService: {
    getMyPendingOrganizationInvitations: (...args: unknown[]) =>
      getMyPendingOrganizationInvitationsMock(...args),
  },
}));

vi.mock("@/lib/pending-organization-join-cookie", () => ({
  getPendingOrganizationJoinToken: (...args: unknown[]) =>
    getPendingOrganizationJoinTokenMock(...args),
  clearPendingOrganizationJoinToken: (...args: unknown[]) =>
    clearPendingOrganizationJoinTokenMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    resolveOrganizationInviteLink: (...args: unknown[]) =>
      resolveOrganizationInviteLinkMock(...args),
  },
}));

vi.mock("../components/workspace-gate-sign-out.client", () => ({
  WorkspaceGateSignOut: () => <button type="button">Sign out</button>,
}));

vi.mock("../components/workspace-gate-retry.client", () => ({
  WorkspaceGateRetry: () => <button type="button">Try again</button>,
}));

vi.mock("../components/identity-onboarding-form.client", () => ({
  IdentityOnboardingForm: ({
    initialName,
    workspaceReady,
  }: {
    initialName: string;
    workspaceReady: boolean;
  }) => (
    <div data-testid="identity-onboarding-form">
      {initialName}
      {workspaceReady ? "workspace-ready" : ""}
    </div>
  ),
}));

vi.mock("../components/pending-invites-queue.client", () => ({
  PendingInvitesQueue: ({
    items,
  }: {
    items: Array<{ kind: string; organizationName: string }>;
  }) => (
    <div data-testid="pending-invites-queue">
      {items.map((item) => item.organizationName).join(",")}
    </div>
  ),
}));

describe("WorkspaceGatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionOrRedirectMock.mockResolvedValue({
      user: { id: "user-1", name: "Ada Lovelace" },
      session: { id: "session-1" },
    });
    getTranslationsMock.mockResolvedValue((key: string) => key);
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([]);
    getPendingOrganizationJoinTokenMock.mockResolvedValue(null);
  });

  it("keeps a ready user on the identity form so an open wizard can survive refresh", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "ready",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: true,
      hasPendingOrganizationInvites: false,
    });

    const { default: WorkspaceGatePage } = await import("../page");

    const ui = await WorkspaceGatePage();

    expect(ui).toBeTruthy();
    const serialized = JSON.stringify(ui);
    expect(serialized).not.toContain("identityTitle");
    expect(serialized).toContain('"initialName":"Ada Lovelace"');
    expect(serialized).toContain('"workspaceReady":true');
    expect(serialized).not.toContain("pendingInvitesTitle");
  });

  it("does not swap a ready user onto the pending-invites queue", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "ready",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: true,
      hasPendingOrganizationInvites: true,
    });
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        organization: { name: "Acme", slug: "acme" },
      },
    ]);

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    expect(getMyPendingOrganizationInvitationsMock).not.toHaveBeenCalled();
    const serialized = JSON.stringify(ui);
    expect(serialized).not.toContain("identityTitle");
    expect(serialized).toContain('"workspaceReady":true');
    expect(serialized).not.toContain("pendingInvitesTitle");
    expect(serialized).not.toContain("Acme");
  });

  it("renders the identity form when workspace access is identity-onboarding", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    expect(ui).toBeTruthy();
    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("identityTitle");
    expect(serialized).toContain("identityDescriptionConfirm");
    expect(serialized).not.toContain("identityDescriptionEnter");
    expect(serialized).toContain('"initialName":"Ada Lovelace"');
    expect(serialized).not.toContain("unavailableTitle");
    expect(serialized).not.toContain("data-workspace-gate-actions");
  });

  it("asks a nameless user to enter their name", async () => {
    getSessionOrRedirectMock.mockResolvedValue({
      user: { id: "user-1", name: "" },
      session: { id: "session-1" },
    });
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();
    const serialized = JSON.stringify(ui);

    expect(serialized).toContain("identityDescriptionEnter");
    expect(serialized).not.toContain("identityDescriptionConfirm");
  });

  it("renders the pending queue instead of identity onboarding", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
    });
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        organization: { name: "Acme", slug: "acme" },
      },
    ]);

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("pendingInvitesTitle");
    expect(serialized).toContain("Acme");
    expect(serialized).toContain("acme");
    expect(serialized).not.toContain("identityTitle");
    expect(serialized).not.toContain("data-workspace-gate-actions");
  });

  it("renders the pending queue when only a recovered join link exists", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: {
        status: "valid",
        organization: { name: "Join Co", slug: "join-co", logo: null },
      },
    });

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("pendingInvitesTitle");
    expect(serialized).toContain("Join Co");
    expect(serialized).toContain("join-co");
    expect(serialized).not.toContain("identityTitle");
  });

  it("does not add a join row when the cookie org already has an invitation", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
    });
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        organization: { name: "Acme", slug: "acme" },
      },
    ]);
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: {
        status: "valid",
        organization: { name: "Acme", slug: "acme", logo: null },
      },
    });

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();
    const serialized = JSON.stringify(ui);

    expect(serialized).toContain('"kind":"invitation"');
    expect(serialized).toContain("Acme");
    expect(serialized).not.toContain('"kind":"join"');
  });

  it("keeps a join row when the cookie org is not already invited", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
    });
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        organization: { name: "Acme", slug: "acme" },
      },
    ]);
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: {
        status: "valid",
        organization: { name: "Join Co", slug: "join-co", logo: null },
      },
    });

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();
    const serialized = JSON.stringify(ui);

    expect(serialized).toContain('"kind":"invitation"');
    expect(serialized).toContain("Acme");
    expect(serialized).toContain('"kind":"join"');
    expect(serialized).toContain("Join Co");
  });

  it("renders unavailable surface when workspace access throws (not identity onboarding)", async () => {
    getWorkspaceAccessMock.mockRejectedValue(new Error("Core down"));

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("unavailableTitle");
    expect(serialized).toContain("unavailableBody");
    expect(serialized).toContain('"data-gate":"unavailable"');
    expect(serialized).toContain("data-workspace-gate-actions");
    expect(serialized).not.toContain("identityTitle");
    expect(serialized).not.toContain('"initialName"');
  });

  it("renders unavailable surface when workspace access is null for a signed-in user", async () => {
    getWorkspaceAccessMock.mockResolvedValue(null);

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("unavailableTitle");
    expect(serialized).toContain("data-workspace-gate-actions");
  });

  it("renders unavailable when pending-invites list fetch fails and there is no join link", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
    });
    getMyPendingOrganizationInvitationsMock.mockRejectedValue(
      new Error("list down"),
    );

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();
    const serialized = JSON.stringify(ui);

    expect(serialized).toContain("unavailableTitle");
    expect(serialized).not.toContain('"initialName"');
    expect(serialized).not.toContain("pending-invites-queue");
  });

  it("does not clear a join cookie when resolve throws", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockRejectedValue(
      new Error("Core timeout"),
    );

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    expect(clearPendingOrganizationJoinTokenMock).not.toHaveBeenCalled();
    expect(JSON.stringify(ui)).toContain("identityTitle");
  });

  it("does not clear a join cookie when the token is no longer valid", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: { status: "expired", organization: null },
    });

    const { default: WorkspaceGatePage } = await import("../page");
    await WorkspaceGatePage();

    expect(clearPendingOrganizationJoinTokenMock).not.toHaveBeenCalled();
  });
});
