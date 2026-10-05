import { beforeEach, describe, expect, it, vi } from "vitest";

const readRouteSessionMock = vi.fn();
const redirectMock = vi.fn();
const getWorkspaceAccessMock = vi.fn();
const getMyPendingOrganizationInvitationsMock = vi.fn();
const getPendingOrganizationJoinTokenMock = vi.fn();
const clearPendingOrganizationJoinTokenMock = vi.fn();
const resolveOrganizationInviteLinkMock = vi.fn();
const getTranslationsMock = vi.fn();

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => redirectMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  signInRedirectPath: async () => "/signin",
}));

vi.mock("@/lib/auth/route-session", () => ({
  readRouteSession: (...args: unknown[]) => readRouteSessionMock(...args),
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getWorkspaceAccess: (...args: unknown[]) => getWorkspaceAccessMock(...args),
  },
}));
vi.mock("@/lib/services/organization.service", () => ({
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

vi.mock("@/app/components/core-unavailable-notice.client", () => ({
  CoreUnavailableNotice: () => <div data-testid="core-unavailable-notice" />,
}));

vi.mock("./components/workspace-gate-sign-out.client", () => ({
  WorkspaceGateSignOut: () => <button type="button">Sign out</button>,
}));

vi.mock("./components/workspace-gate-retry.client", () => ({
  WorkspaceGateRetry: () => <button type="button">Try again</button>,
}));

vi.mock("./components/identity-onboarding-form.client", () => ({
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

vi.mock("./components/pending-invites-queue.client", () => ({
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

function pageProps(searchParams: Record<string, string> = {}) {
  return { searchParams: Promise.resolve(searchParams) };
}

describe("WorkspaceGatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: {
        user: {
          id: "user-1",
          name: "Ada Lovelace",
          firstName: "Ada",
          lastName: "Lovelace",
        },
        session: { id: "session-1" },
      },
    });
    getTranslationsMock.mockResolvedValue((key: string) => key);
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([]);
    getPendingOrganizationJoinTokenMock.mockResolvedValue(null);
  });

  it("still sends a signed-out browser to sign-in", async () => {
    readRouteSessionMock.mockResolvedValue({ status: "signedOut" });
    // The real `redirect` throws NEXT_REDIRECT, which is what stops the page
    // rendering. A mock that returns would let it run on with no session.
    redirectMock.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    const { default: WorkspaceGatePage } = await import("./page");
    await expect(WorkspaceGatePage(pageProps())).rejects.toThrow(
      "NEXT_REDIRECT",
    );

    expect(redirectMock).toHaveBeenCalledWith("/signin");
    expect(getWorkspaceAccessMock).not.toHaveBeenCalled();
  });

  it("shows the Core notice instead of throwing when the session read fails", async () => {
    // `(flows)` has no `error.tsx`, so a throw here lands on the bare
    // "Application error" page rather than anything themed.
    readRouteSessionMock.mockResolvedValue({
      status: "unavailable",
      reason: "timeout",
    });

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

    const { CoreUnavailableNotice } = await import(
      "@/app/components/core-unavailable-notice.client"
    );
    expect((ui as { type: unknown }).type).toBe(CoreUnavailableNotice);
    expect(getWorkspaceAccessMock).not.toHaveBeenCalled();
  });

  it("keeps a ready user on the identity form so an open wizard can survive refresh", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "ready",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: true,
    });

    const { default: WorkspaceGatePage } = await import("./page");

    const ui = await WorkspaceGatePage(pageProps());

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
    });
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        organization: { name: "Acme", slug: "acme" },
      },
    ]);

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

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
    });

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

    expect(ui).toBeTruthy();
    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("identityTitle");
    expect(serialized).toContain("identityDescriptionChoose");
    expect(serialized).not.toContain("identityDescriptionEnter");
    expect(serialized).toContain('"askName":false');
    expect(serialized).toContain('"initialName":"Ada Lovelace"');
    expect(serialized).not.toContain("unavailableTitle");
    expect(serialized).not.toContain("data-workspace-gate-actions");
  });

  it("asks a user who has a display name but no name parts to enter them", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: {
        user: {
          id: "user-1",
          name: "Countess of Lovelace",
          firstName: null,
          lastName: null,
        },
        session: { id: "session-1" },
      },
    });
    getWorkspaceAccessMock.mockResolvedValue({ gate: "identity-onboarding" });

    const { default: WorkspaceGatePage } = await import("./page");
    const serialized = JSON.stringify(await WorkspaceGatePage(pageProps()));

    expect(serialized).toContain("identityDescriptionEnter");
    expect(serialized).not.toContain("identityDescriptionChoose");
    expect(serialized).toContain('"initialName":"Countess of Lovelace"');
  });

  it.each([
    { firstName: undefined, lastName: "Lovelace", askName: true },
    { firstName: "Ada", lastName: null, askName: true },
    { firstName: "", lastName: "Lovelace", askName: true },
    { firstName: "Ada", lastName: " \t ", askName: true },
    { firstName: " Ada ", lastName: " Lovelace ", askName: false },
    { firstName: "a".repeat(100), lastName: "b".repeat(27), askName: false },
    { firstName: "a".repeat(27), lastName: "b".repeat(100), askName: false },
    { firstName: "a".repeat(128), lastName: "b", askName: true },
  ])(
    "validates and passes the same trimmed stored pair: $askName",
    async (parts) => {
      readRouteSessionMock.mockResolvedValue({
        status: "authenticated",
        session: {
          user: {
            id: "user-1",
            name: "Display name",
            firstName: parts.firstName,
            lastName: parts.lastName,
          },
          session: { id: "session-1" },
        },
      });
      getWorkspaceAccessMock.mockResolvedValue({ gate: "identity-onboarding" });
      const { default: WorkspaceGatePage } = await import("./page");
      const serialized = JSON.stringify(await WorkspaceGatePage(pageProps()));
      expect(serialized).toContain(`"askName":${parts.askName}`);
      expect(serialized).toContain(
        JSON.stringify({
          initialFirstName: parts.firstName?.trim() ?? "",
        }).slice(1, -1),
      );
      expect(serialized).toContain(
        JSON.stringify({ initialLastName: parts.lastName?.trim() ?? "" }).slice(
          1,
          -1,
        ),
      );
      expect(serialized).toContain(
        parts.askName
          ? "identityDescriptionEnter"
          : "identityDescriptionChoose",
      );
    },
  );

  it("asks again when the stored name does not pass validation", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: {
        user: {
          id: "user-1",
          name: "",
          firstName: "a".repeat(64),
          lastName: "b".repeat(64),
        },
        session: { id: "session-1" },
      },
    });
    getWorkspaceAccessMock.mockResolvedValue({ gate: "identity-onboarding" });

    const { default: WorkspaceGatePage } = await import("./page");
    const serialized = JSON.stringify(await WorkspaceGatePage(pageProps()));

    expect(serialized).toContain("identityDescriptionEnter");
    expect(serialized).toContain('"askName":true');
  });

  it("asks a nameless user to enter their name", async () => {
    readRouteSessionMock.mockResolvedValue({
      status: "authenticated",
      session: {
        user: { id: "user-1", name: "" },
        session: { id: "session-1" },
      },
    });
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
    });

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());
    const serialized = JSON.stringify(ui);

    expect(serialized).toContain("identityDescriptionEnter");
    expect(serialized).not.toContain("identityDescriptionChoose");
  });

  it("renders the pending queue instead of identity onboarding", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
    });
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        organization: { name: "Acme", slug: "acme" },
      },
    ]);

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("pendingInvitesTitle");
    expect(serialized).toContain("pendingInvitesDescriptionInvitations");
    expect(serialized).not.toContain("pendingInvitesDescriptionJoin");
    expect(serialized).not.toContain("pendingInvitesDescriptionBoth");
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
    });
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: {
        status: "valid",
        organization: { name: "Join Co", slug: "join-co", logo: null },
      },
    });

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("pendingInvitesTitle");
    expect(serialized).toContain("pendingInvitesDescriptionJoin");
    expect(serialized).not.toContain("pendingInvitesDescriptionInvitations");
    expect(serialized).not.toContain("pendingInvitesDescriptionBoth");
    expect(serialized).toContain("Join Co");
    expect(serialized).toContain("join-co");
    expect(serialized).not.toContain("identityTitle");
  });

  it("does not add a join row when the cookie org already has an invitation", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
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

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());
    const serialized = JSON.stringify(ui);

    expect(serialized).toContain('"kind":"invitation"');
    expect(serialized).toContain("Acme");
    expect(serialized).not.toContain('"kind":"join"');
    expect(serialized).toContain("pendingInvitesDescriptionInvitations");
    expect(serialized).not.toContain("pendingInvitesDescriptionJoin");
    expect(serialized).not.toContain("pendingInvitesDescriptionBoth");
  });

  it("keeps a join row when the cookie org is not already invited", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
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

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());
    const serialized = JSON.stringify(ui);

    expect(serialized).toContain('"kind":"invitation"');
    expect(serialized).toContain("Acme");
    expect(serialized).toContain('"kind":"join"');
    expect(serialized).toContain("Join Co");
    expect(serialized).toContain("pendingInvitesDescriptionBoth");
    expect(serialized).not.toContain("pendingInvitesDescriptionInvitations");
    expect(serialized).not.toContain("pendingInvitesDescriptionJoin");
  });

  it("renders unavailable surface when workspace access throws (not identity onboarding)", async () => {
    getWorkspaceAccessMock.mockRejectedValue(new Error("Core down"));

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

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

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

    const serialized = JSON.stringify(ui);
    expect(serialized).toContain("unavailableTitle");
    expect(serialized).toContain("data-workspace-gate-actions");
  });

  it("renders unavailable when pending-invites list fetch fails and there is no join link", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
    });
    getMyPendingOrganizationInvitationsMock.mockRejectedValue(
      new Error("list down"),
    );

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());
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
    });
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockRejectedValue(
      new Error("Core timeout"),
    );

    const { default: WorkspaceGatePage } = await import("./page");
    const ui = await WorkspaceGatePage(pageProps());

    expect(clearPendingOrganizationJoinTokenMock).not.toHaveBeenCalled();
    expect(JSON.stringify(ui)).toContain("identityTitle");
  });

  it("does not clear a join cookie when the token is no longer valid", async () => {
    getWorkspaceAccessMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
    });
    getPendingOrganizationJoinTokenMock.mockResolvedValue("join_token_1");
    resolveOrganizationInviteLinkMock.mockResolvedValue({
      data: { status: "expired", organization: null },
    });

    const { default: WorkspaceGatePage } = await import("./page");
    await WorkspaceGatePage(pageProps());

    expect(clearPendingOrganizationJoinTokenMock).not.toHaveBeenCalled();
  });

  it("ends identity onboarding where the user was going", async () => {
    getWorkspaceAccessMock.mockResolvedValue({ gate: "identity-onboarding" });

    const { default: WorkspaceGatePage } = await import("./page");
    const serialized = JSON.stringify(
      await WorkspaceGatePage(
        pageProps({ next: "/chat/join/abc?ref=mail&x=1" }),
      ),
    );

    expect(serialized).toContain('"returnUrl":"/chat/join/abc?ref=mail&x=1"');
  });

  it("ends the pending-invites queue where the user was going", async () => {
    getWorkspaceAccessMock.mockResolvedValue({ gate: "pending-invites" });
    getMyPendingOrganizationInvitationsMock.mockResolvedValue([
      {
        id: "inv_1",
        organizationId: "org_1",
        organization: { name: "Acme", slug: "acme" },
      },
    ]);

    const { default: WorkspaceGatePage } = await import("./page");
    const serialized = JSON.stringify(
      await WorkspaceGatePage(pageProps({ next: "/chat/join/abc" })),
    );

    expect(serialized).toContain("pendingInvitesTitle");
    expect(serialized).toContain('"returnUrl":"/chat/join/abc"');
  });

  it("ends at the app root when no target was carried", async () => {
    getWorkspaceAccessMock.mockResolvedValue({ gate: "identity-onboarding" });

    const { default: WorkspaceGatePage } = await import("./page");
    const serialized = JSON.stringify(await WorkspaceGatePage(pageProps()));

    expect(serialized).toContain('"returnUrl":"/"');
  });

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "javascript:alert(1)",
  ])("never sends a user off-site after setup: %s", async (next) => {
    getWorkspaceAccessMock.mockResolvedValue({ gate: "identity-onboarding" });

    const { default: WorkspaceGatePage } = await import("./page");
    const serialized = JSON.stringify(
      await WorkspaceGatePage(pageProps({ next })),
    );

    expect(serialized).toContain('"returnUrl":"/"');
    expect(serialized).not.toContain("evil.example");
    expect(serialized).not.toContain("javascript:");
  });
});
