import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getOrganizationCallerSeatMock } = vi.hoisted(() => ({
  getOrganizationCallerSeatMock: vi.fn(),
}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getOrganizationCallerSeat: (...args: unknown[]) =>
      getOrganizationCallerSeatMock(...args),
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
    expect(getOrganizationCallerSeatMock).not.toHaveBeenCalled();
  });

  it("returns whether Core treats the caller as seated", async () => {
    getOrganizationCallerSeatMock.mockResolvedValue({
      data: { assigned: false },
    });

    const { canUseOrganizationWorkstation } = await import(
      "./organization-workstation.service"
    );

    await expect(canUseOrganizationWorkstation("org-1")).resolves.toBe(false);
    expect(getOrganizationCallerSeatMock).toHaveBeenCalledWith("org-1");
  });
});
