import { beforeEach, describe, expect, it, vi } from "vitest";

const getMyActiveSubscriptionMock = vi.fn();
const getOrganizationBillingPlanMock = vi.fn();
const getMyMembersWithOrganizationsMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;

    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    getMyActiveSubscription: (...args: unknown[]) =>
      getMyActiveSubscriptionMock(...args),
    getOrganizationBillingPlan: (...args: unknown[]) =>
      getOrganizationBillingPlanMock(...args),
  },
}));

vi.mock("@/lib/services/user.service", () => ({
  userService: {
    getMyMembersWithOrganizations: (...args: unknown[]) =>
      getMyMembersWithOrganizationsMock(...args),
  },
}));

describe("userHasPaidOrEnterpriseCoverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: null },
    });
    getMyMembersWithOrganizationsMock.mockResolvedValue([]);
  });

  async function loadCoverage() {
    const { userHasPaidOrEnterpriseCoverage } = await import(
      "../subscription-onboarding-coverage.service"
    );
    return userHasPaidOrEnterpriseCoverage;
  }

  it("returns true for a personal paid subscription", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: {
        subscription: {
          plan: "pro",
          status: "active",
        },
      },
    });

    const userHasPaidOrEnterpriseCoverage = await loadCoverage();

    await expect(userHasPaidOrEnterpriseCoverage()).resolves.toBe(true);
    expect(getOrganizationBillingPlanMock).not.toHaveBeenCalled();
  });

  it("returns false for a personal free subscription with no orgs", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: {
        subscription: {
          plan: "free",
          status: "active",
        },
      },
    });

    const userHasPaidOrEnterpriseCoverage = await loadCoverage();

    await expect(userHasPaidOrEnterpriseCoverage()).resolves.toBe(false);
  });

  it("returns true when any organization has an enterprise contract", async () => {
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      { organizationId: "org-free" },
      { organizationId: "org-enterprise" },
    ]);
    getOrganizationBillingPlanMock
      .mockResolvedValueOnce({
        data: {
          mode: "self_serve",
          plan: "free",
          isConsumable: false,
          purchasedSeats: 0,
          cancelAtPeriodEnd: false,
          periodEnd: null,
        },
      })
      .mockResolvedValueOnce({
        data: {
          mode: "enterprise_contract",
          plan: "enterprise",
          isConsumable: true,
          purchasedSeats: 10,
          cancelAtPeriodEnd: false,
          periodEnd: null,
        },
      });

    const userHasPaidOrEnterpriseCoverage = await loadCoverage();

    await expect(userHasPaidOrEnterpriseCoverage()).resolves.toBe(true);
    expect(getOrganizationBillingPlanMock).toHaveBeenCalledTimes(2);
  });

  it("returns true when any organization has a paid self-serve plan", async () => {
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      { organizationId: "org-1" },
    ]);
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        mode: "self_serve",
        plan: "starter",
        isConsumable: false,
        purchasedSeats: 3,
        cancelAtPeriodEnd: false,
        periodEnd: "2026-08-01T00:00:00.000Z",
      },
    });

    const userHasPaidOrEnterpriseCoverage = await loadCoverage();

    await expect(userHasPaidOrEnterpriseCoverage()).resolves.toBe(true);
  });

  it("returns false when personal and all org plans are free", async () => {
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      { organizationId: "org-1" },
    ]);
    getOrganizationBillingPlanMock.mockResolvedValue({
      data: {
        mode: "self_serve",
        plan: "free",
        isConsumable: false,
        purchasedSeats: 0,
        cancelAtPeriodEnd: false,
        periodEnd: null,
      },
    });

    const userHasPaidOrEnterpriseCoverage = await loadCoverage();

    await expect(userHasPaidOrEnterpriseCoverage()).resolves.toBe(false);
  });

  it("ignores inaccessible organization billing plans", async () => {
    const { CoreApiRequestError } = await import("@/lib/clients/core.client");
    getMyMembersWithOrganizationsMock.mockResolvedValue([
      { organizationId: "org-gone" },
    ]);
    getOrganizationBillingPlanMock.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );

    const userHasPaidOrEnterpriseCoverage = await loadCoverage();

    await expect(userHasPaidOrEnterpriseCoverage()).resolves.toBe(false);
  });

  it("returns false when membership reads fail unexpectedly", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    getMyMembersWithOrganizationsMock.mockRejectedValue(
      new Error("Core outage"),
    );

    const userHasPaidOrEnterpriseCoverage = await loadCoverage();

    await expect(userHasPaidOrEnterpriseCoverage()).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to resolve subscription onboarding coverage",
      expect.any(Error),
    );
  });
});
