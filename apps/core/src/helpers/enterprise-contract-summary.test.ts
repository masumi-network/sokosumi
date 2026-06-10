import type { Prisma } from "@sokosumi/database";
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
  resolveEnterprisePeriodEndForDisplay,
  resolveNextEnterpriseActivationAt,
} from "./enterprise-contract-summary.js";

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

  it("falls back to the last period end after the commercial term", () => {
    const periods = [
      {
        periodStart: new Date("2026-01-15T00:00:00.000Z"),
        periodEnd: new Date("2026-02-14T23:59:59.999Z"),
      },
      {
        periodStart: new Date("2026-02-15T00:00:00.000Z"),
        periodEnd: new Date("2026-03-14T23:59:59.999Z"),
      },
    ];

    expect(
      resolveEnterprisePeriodEndForDisplay(
        periods,
        new Date("2026-04-01T00:00:00.000Z"),
        false,
      )?.toISOString(),
    ).toBe("2026-03-14T23:59:59.999Z");
  });
});

describe("getEnterpriseContractBillingSummary", () => {
  const mockTx = {} as Prisma.TransactionClient;
  const billingPlan = {
    mode: "enterprise_contract" as const,
    plan: "enterprise" as const,
    isConsumable: true,
    purchasedSeats: 10,
    contractId: "contract-1",
    endsAt: new Date("2026-12-14T23:59:59.999Z"),
    activatedAt: new Date("2026-01-15T00:00:00.000Z"),
    cancelAtPeriodEnd: false as const,
    periodEnd: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a billing-plan fallback when the contract cannot be loaded", async () => {
    getContractWithPeriodsMock.mockResolvedValue(null);
    sumOrganizationEnterprisePoolBalancesMock.mockResolvedValue({
      remainingCents: BigInt(12_500_000_000_000),
      totalCents: BigInt(12_500_000_000_000),
    });

    const summary = await getEnterpriseContractBillingSummary(
      billingPlan,
      "org-1",
      mockTx,
    );

    expect(summary).toEqual({
      activatedAt: billingPlan.activatedAt,
      endsAt: billingPlan.endsAt,
      currentPeriodEnd: null,
      isConsumable: true,
      monthlyCredits: null,
      nextActivationAt: null,
      poolRemainingCredits: 1_250,
      purchasedSeats: 10,
    });
  });

  it("returns a billing-plan fallback when the contract belongs to another organization", async () => {
    getContractWithPeriodsMock.mockResolvedValue({
      centsPerMonth: BigInt(60_000_000_000_000),
      organizationId: "org-other",
      periods: [],
    });
    sumOrganizationEnterprisePoolBalancesMock.mockResolvedValue({
      remainingCents: BigInt(0),
      totalCents: BigInt(0),
    });

    const summary = await getEnterpriseContractBillingSummary(
      billingPlan,
      "org-1",
      mockTx,
    );

    expect(summary).toEqual({
      activatedAt: billingPlan.activatedAt,
      endsAt: billingPlan.endsAt,
      currentPeriodEnd: null,
      isConsumable: true,
      monthlyCredits: null,
      nextActivationAt: null,
      poolRemainingCredits: 0,
      purchasedSeats: 10,
    });
  });

  it("maps contract, period, and pool data into a billing summary", async () => {
    getContractWithPeriodsMock.mockResolvedValue({
      centsPerMonth: BigInt(60_000_000_000_000),
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
      remainingCents: BigInt(25_000_000_000_000),
      totalCents: BigInt(60_000_000_000_000),
    });

    const summary = await getEnterpriseContractBillingSummary(
      billingPlan,
      "org-1",
      mockTx,
      new Date("2026-02-15T12:00:00.000Z"),
    );

    expect(summary).toEqual({
      activatedAt: billingPlan.activatedAt,
      endsAt: billingPlan.endsAt,
      currentPeriodEnd: new Date("2026-03-14T23:59:59.999Z"),
      isConsumable: true,
      monthlyCredits: 6_000,
      nextActivationAt: new Date("2026-03-15T00:00:00.000Z"),
      poolRemainingCredits: 2_500,
      purchasedSeats: 10,
    });
  });

  it("uses the last period end when the contract is post-term", async () => {
    getContractWithPeriodsMock.mockResolvedValue({
      centsPerMonth: BigInt(60_000_000_000_000),
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
      ],
    });
    sumOrganizationEnterprisePoolBalancesMock.mockResolvedValue({
      remainingCents: BigInt(0),
      totalCents: BigInt(0),
    });

    const summary = await getEnterpriseContractBillingSummary(
      { ...billingPlan, isConsumable: false },
      "org-1",
      mockTx,
      new Date("2026-04-01T00:00:00.000Z"),
    );

    expect(summary?.currentPeriodEnd?.toISOString()).toBe(
      "2026-03-14T23:59:59.999Z",
    );
  });
});
