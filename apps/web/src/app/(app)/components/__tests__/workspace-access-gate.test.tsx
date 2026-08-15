import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionOrRedirectMock = vi.fn();
const getWorkspaceGateMock = vi.fn();
const redirectMock = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirectMock(path),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSessionOrRedirect: (...args: unknown[]) =>
    getSessionOrRedirectMock(...args),
}));

vi.mock("@/lib/services", () => ({
  userService: {
    getWorkspaceGate: (...args: unknown[]) => getWorkspaceGateMock(...args),
  },
}));

describe("WorkspaceAccessGate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionOrRedirectMock.mockResolvedValue({
      user: { id: "user-1" },
      session: { id: "session-1" },
    });
  });

  it("redirects not-ready users before chrome mounts", async () => {
    getWorkspaceGateMock.mockResolvedValue({
      gate: "identity-onboarding",
      hasPersonalWorkspace: false,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: WorkspaceAccessGate } = await import(
      "../workspace-access-gate"
    );

    await expect(
      WorkspaceAccessGate({ children: <div data-chrome>chrome</div> }),
    ).rejects.toThrow("REDIRECT:/workspace-gate");
    expect(redirectMock).toHaveBeenCalledWith("/workspace-gate");
  });

  it("redirects when inventory throws (fail closed, no chrome)", async () => {
    getWorkspaceGateMock.mockRejectedValue(new Error("Core down"));

    const { default: WorkspaceAccessGate } = await import(
      "../workspace-access-gate"
    );

    await expect(
      WorkspaceAccessGate({ children: <div>chrome</div> }),
    ).rejects.toThrow("REDIRECT:/workspace-gate");
  });

  it("renders children when ready", async () => {
    getWorkspaceGateMock.mockResolvedValue({
      gate: "ready",
      hasPersonalWorkspace: true,
      hasOrganizationMembership: false,
      hasPendingOrganizationInvites: false,
    });

    const { default: WorkspaceAccessGate } = await import(
      "../workspace-access-gate"
    );

    const ui = await WorkspaceAccessGate({
      children: <div data-ready-child>ok</div>,
    });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(ui).toBeTruthy();
  });
});
