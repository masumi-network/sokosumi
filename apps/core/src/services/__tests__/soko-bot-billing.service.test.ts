import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  balanceMock,
  billingPlanMock,
  getEnvMock,
  memberFindManyMock,
  prepareConsumptionMock,
  subscriptionMock,
  usageCreateMock,
  usageFindUniqueMock,
  userFindUniqueMock,
  transactionCreateMock,
} = vi.hoisted(() => ({
  balanceMock: vi.fn(),
  billingPlanMock: vi.fn(),
  getEnvMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  prepareConsumptionMock: vi.fn(),
  subscriptionMock: vi.fn(),
  usageCreateMock: vi.fn(),
  usageFindUniqueMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  transactionCreateMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    member: { findMany: memberFindManyMock },
  },
}));
vi.mock("@sokosumi/database/helpers", () => ({
  resolveOrganizationBillingPlan: billingPlanMock,
}));
vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    getBalance: balanceMock,
    prepareConsumption: prepareConsumptionMock,
  },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: subscriptionMock,
  },
}));

import { convertCreditsToCents } from "@sokosumi/utils";

import {
  recordSokoBotTurnUsage,
  requireSokoBotTurnFunding,
  SokoBotBillingAccessError,
  sokoBotUsageCents,
  userHasSokoBotPaidCoverage,
} from "@/services/soko-bot-billing.service";

function transactionClient() {
  return {
    orchestratorUsage: {
      create: usageCreateMock,
      findUnique: usageFindUniqueMock,
    },
    transaction: { create: transactionCreateMock },
  };
}

describe("Soko Bot billing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      SOKO_BOT_CREDITS_PER_USD: 100,
      SOKO_BOT_MIN_TURN_CREDITS: 0.1,
    });
    userFindUniqueMock.mockResolvedValue({ role: "user" });
    memberFindManyMock.mockResolvedValue([]);
    subscriptionMock.mockResolvedValue(null);
  });

  it("maps runtime USD usage to configured credits with a minimum", () => {
    expect(sokoBotUsageCents(500n)).toBe(convertCreditsToCents(0.1));
    expect(sokoBotUsageCents(2_000_000n)).toBe(convertCreditsToCents(200));
    expect(sokoBotUsageCents(0n)).toBe(0n);
  });

  it("accepts personal or organization paid coverage", async () => {
    subscriptionMock.mockResolvedValueOnce({ plan: "starter" });
    await expect(userHasSokoBotPaidCoverage("user_1")).resolves.toBe(true);

    subscriptionMock.mockResolvedValue(null);
    memberFindManyMock.mockResolvedValue([{ organizationId: "org_1" }]);
    billingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      isConsumable: true,
    });
    await expect(userHasSokoBotPaidCoverage("user_1")).resolves.toBe(true);
  });

  it("accepts platform admin coverage without a subscription", async () => {
    userFindUniqueMock.mockResolvedValue({ role: "user, admin" });

    await expect(userHasSokoBotPaidCoverage("user_1")).resolves.toBe(true);
    expect(subscriptionMock).not.toHaveBeenCalled();
  });

  it("fails closed without paid coverage or minimum personal credits", async () => {
    await expect(requireSokoBotTurnFunding("user_1")).rejects.toBeInstanceOf(
      SokoBotBillingAccessError,
    );

    subscriptionMock.mockResolvedValue({ plan: "starter" });
    balanceMock.mockResolvedValue(0n);
    await expect(requireSokoBotTurnFunding("user_1")).rejects.toThrow(
      "Insufficient personal credits",
    );
  });

  it("records one idempotent personal credit charge per turn", async () => {
    const expected = convertCreditsToCents(100);
    usageFindUniqueMock.mockResolvedValue(null);
    balanceMock.mockResolvedValue(expected);
    prepareConsumptionMock.mockResolvedValue([
      { bucketId: "bucket_1", amount: expected },
    ]);
    transactionCreateMock.mockResolvedValue({ id: "transaction_1" });
    usageCreateMock.mockResolvedValue({ id: "usage_1" });

    const result = await recordSokoBotTurnUsage(
      {
        turnId: "turn_1",
        sokoBotId: "01960001-0001-7001-8001-000000000001",
        userId: "user_1",
        costUsdMicros: 1_000_000n,
      },
      transactionClient() as never,
    );

    expect(result).toEqual({
      chargedCents: expected,
      expectedCents: expected,
      shortfall: false,
    });
    expect(transactionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: -expected,
          organizationId: null,
          userId: "user_1",
        }),
      }),
    );
    expect(usageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idempotencyKey: "soko-bot-turn:turn_1",
          referenceId: "turn_1",
          cents: expected,
        }),
      }),
    );
  });

  it("returns existing charge and reports a metering shortfall", async () => {
    const charged = convertCreditsToCents(5);
    usageFindUniqueMock.mockResolvedValue({ cents: charged });

    const result = await recordSokoBotTurnUsage(
      {
        turnId: "turn_1",
        sokoBotId: "01960001-0001-7001-8001-000000000001",
        userId: "user_1",
        costUsdMicros: 1_000_000n,
      },
      transactionClient() as never,
    );

    expect(result).toEqual({
      chargedCents: charged,
      expectedCents: convertCreditsToCents(100),
      shortfall: true,
    });
    expect(transactionCreateMock).not.toHaveBeenCalled();
  });
});
