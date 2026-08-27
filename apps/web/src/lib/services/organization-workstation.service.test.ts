import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getOrganizationWorkstationMock } = vi.hoisted(() => ({
  getOrganizationWorkstationMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getOrganizationWorkstation: (...args: unknown[]) =>
      getOrganizationWorkstationMock(...args),
  },
}));

describe("canUseOrganizationWorkstation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a personal workspace", async () => {
    const { canUseOrganizationWorkstation } = await import(
      "./organization-workstation.service"
    );

    await expect(canUseOrganizationWorkstation(null)).resolves.toBe(true);
    expect(getOrganizationWorkstationMock).not.toHaveBeenCalled();
  });

  it("returns Core's workstation decision for an organization", async () => {
    getOrganizationWorkstationMock.mockResolvedValue({
      data: { canUse: false },
    });

    const { canUseOrganizationWorkstation } = await import(
      "./organization-workstation.service"
    );

    await expect(canUseOrganizationWorkstation("org-1")).resolves.toBe(false);
    expect(getOrganizationWorkstationMock).toHaveBeenCalledWith("org-1");
  });
});
