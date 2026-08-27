import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getOrganizationBillingPlanMock, getMyMemberInOrganizationMock } =
  vi.hoisted(() => ({
    getOrganizationBillingPlanMock: vi.fn(),
    getMyMemberInOrganizationMock: vi.fn(),
  }));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getOrganizationBillingPlan: (...args: unknown[]) =>
      getOrganizationBillingPlanMock(...args),
    getMyMemberInOrganization: (...args: unknown[]) =>
      getMyMemberInOrganizationMock(...args),
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
    expect(getOrganizationBillingPlanMock).not.toHaveBeenCalled();
  });

  it("allows unseated members of a free organization", async () => {
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: { mode: "self_serve", plan: "free" },
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { seatAssignedAt: null },
    });

    const { canUseOrganizationWorkstation } = await import(
      "./organization-workstation.service"
    );

    await expect(canUseOrganizationWorkstation("org-1")).resolves.toBe(true);
  });

  it("denies unseated members of a paid organization", async () => {
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: { mode: "self_serve", plan: "starter" },
    });
    getMyMemberInOrganizationMock.mockResolvedValue({
      data: { seatAssignedAt: null },
    });

    const { canUseOrganizationWorkstation } = await import(
      "./organization-workstation.service"
    );

    await expect(canUseOrganizationWorkstation("org-1")).resolves.toBe(false);
  });
});
