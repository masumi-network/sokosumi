import { beforeEach, describe, expect, it, vi } from "vitest";

const getContractWithPeriodsMock = vi.fn();
const sumOrganizationEnterprisePoolBalancesMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    sumOrganizationEnterprisePoolBalances: (...args: unknown[]) =>
      sumOrganizationEnterprisePoolBalancesMock(...args),
  },
  enterpriseContractRepository: {
    getContractWithPeriods: (...args: unknown[]) =>
      getContractWithPeriodsMock(...args),
  },
}));

import {
  getEnterpriseContractBillingSummary,
  resolveCurrentEnterprisePeriodEnd,
  resolveNextEnterpriseActivationAt,
} from "@/lib/services/enterprise-contract-summary.service";

describe("enterprise contract summary helpers", () => {
  const now = new Date("2026-02-15T12:00:00.000Z");

  it("resolves the current period end from the active window", () => {
    const currentPeriodEnd = resolveCurrentEnterprisePeriodEnd(
      [
        {
          periodStart: new Date("2026-01-15T00:00:00.000Z"),
          periodEnd: new Date("2026-02-14T23:59:59.999Z"),
        },
        {
          periodStart: new Date("2026-02-15T00:00:00.000Z"),
          periodEnd: new Date("2026-03-14T23:59:59.999Z"),
        },
      ],
      now,
    );

    expect(currentPeriodEnd?.toISOString()).toBe("2026-03-14T23:59:59.999Z");
  });

  it("resolves the next activation from the earliest upcoming period", () => {
    const nextActivationAt = resolveNextEnterpriseActivationAt(
      [
        {
          periodStart: new Date("2026-01-15T00:00:00.000Z"),
          periodEnd: new Date("2026-02-14T23:59:59.999Z"),
        },
        {
          periodStart: new Date("2026-03-15T00:00:00.000Z"),
          periodEnd: new Date("2026-04-14T23:59:59.999Z"),
        },
        {
          periodStart: new Date("2026-02-15T00:00:00.000Z"),
          periodEnd: new Date("2026-03-14T23:59:59.999Z"),
        },
      ],
      new Date("2026-01-20T12:00:00.000Z"),
    );

    expect(nextActivationAt?.toISOString()).toBe("2026-02-15T00:00:00.000Z");
  });
});

describe("getEnterpriseContractBillingSummary", () => {
  const billingPlan = {
    mode: "enterprise_contract" as const,
    plan: "enterprise" as const,
    isConsumable: true,
    purchasedSeats: 10,
    contractId: "contract-1",
    contractEnd: new Date("2026-12-14T23:59:59.999Z"),
    activatedAt: new Date("2026-01-15T00:00:00.000Z"),
    cancelAtPeriodEnd: false as const,
    periodEnd: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the contract cannot be loaded", async () => {
    getContractWithPeriodsMock.mockResolvedValue(null);
    sumOrganizationEnterprisePoolBalancesMock.mockResolvedValue({
      remainingCents: 0n,
      totalCents: 0n,
    });

    const summary = await getEnterpriseContractBillingSummary(
      billingPlan,
      "org-1",
      {},
    );

    expect(summary).toBeNull();
  });

  it("returns null when the contract belongs to another organization", async () => {
    getContractWithPeriodsMock.mockResolvedValue({
      centsPerMonth: 60_000_000_000_000n,
      organizationId: "org-other",
      periods: [],
    });
    sumOrganizationEnterprisePoolBalancesMock.mockResolvedValue({
      remainingCents: 0n,
      totalCents: 0n,
    });

    const summary = await getEnterpriseContractBillingSummary(
      billingPlan,
      "org-1",
      {},
    );

    expect(summary).toBeNull();
  });

  it("maps contract, period, and pool data into a billing summary", async () => {
    getContractWithPeriodsMock.mockResolvedValue({
      centsPerMonth: 60_000_000_000_000n,
      organizationId: "org-1",
      periods: [
        {
          periodStart: new Date("2026-01-15T00:00:00.000Z"),
          periodEnd: new Date("2026-02-14T23:59:59.999Z"),
        },
        {
          periodStart: new Date("2026-02-15T00:00:00.000Z"),
          periodEnd: new Date("2026-03-14T23:59:59.999Z"),
        },
        {
          periodStart: new Date("2026-03-15T00:00:00.000Z"),
          periodEnd: new Date("2026-04-14T23:59:59.999Z"),
        },
      ],
    });
    sumOrganizationEnterprisePoolBalancesMock.mockResolvedValue({
      remainingCents: 25_000_000_000_000n,
      totalCents: 60_000_000_000_000n,
    });

    const summary = await getEnterpriseContractBillingSummary(
      billingPlan,
      "org-1",
      {},
      new Date("2026-02-15T12:00:00.000Z"),
    );

    expect(summary).toEqual({
      activatedAt: billingPlan.activatedAt,
      contractEnd: billingPlan.contractEnd,
      currentPeriodEnd: new Date("2026-03-14T23:59:59.999Z"),
      isConsumable: true,
      monthlyCredits: 6_000,
      nextActivationAt: new Date("2026-03-15T00:00:00.000Z"),
      poolRemainingCredits: 2_500,
      poolTotalCredits: 6_000,
      purchasedSeats: 10,
    });
  });
});
