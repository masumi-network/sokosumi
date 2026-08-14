import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionOrRedirectMock = vi.fn();
const getWorkspaceInventoryMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
const getTranslationsMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: (...args: unknown[]) => getTranslationsMock(...args),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: (...args: unknown[]) =>
    getSessionOrRedirectMock(...args),
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getWorkspaceInventory: (...args: unknown[]) =>
      getWorkspaceInventoryMock(...args),
  },
}));

vi.mock("../components/workspace-gate-sign-out.client", () => ({
  WorkspaceGateSignOut: () => <button type="button">Sign out</button>,
}));

describe("WorkspaceGatePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionOrRedirectMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { id: "session-1" },
    });
    getTranslationsMock.mockResolvedValue((key: string) => key);
  });

  it("redirects ready users away from the gate", async () => {
    getWorkspaceInventoryMock.mockResolvedValue({
      gate: "ready",
      hasPersonalWorkspace: true,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: WorkspaceGatePage } = await import("../page");

    await expect(WorkspaceGatePage()).rejects.toThrow("REDIRECT:/");
    expect(redirectMock).toHaveBeenCalledWith("/");
  });

  it("renders the identity gate when inventory is not ready", async () => {
    getWorkspaceInventoryMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(ui).toBeTruthy();
  });

  it("renders pending-invites copy when inventory reports pending invites", async () => {
    getWorkspaceInventoryMock.mockResolvedValue({
      gate: "pending-invites",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: true,
    });

    const { default: WorkspaceGatePage } = await import("../page");
    const ui = await WorkspaceGatePage();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(ui).toBeTruthy();
  });
});
