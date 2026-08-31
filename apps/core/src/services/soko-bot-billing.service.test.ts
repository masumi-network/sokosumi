import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  balanceMock,
  billingPlanMock,
  getEnvMock,
  memberFindManyMock,
  prepareConsumptionMock,
  subscriptionMock,
  usageCreateMock,
  usageFindManyMock,
  usageFindUniqueMock,
  turnFindFirstMock,
  turnFindManyMock,
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
  usageFindManyMock: vi.fn(),
  usageFindUniqueMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
  turnFindManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  transactionCreateMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    member: { findMany: memberFindManyMock },
    orchestratorUsage: {
      findMany: usageFindManyMock,
      findUnique: usageFindUniqueMock,
    },
    sokoBotTurn: {
      findFirst: turnFindFirstMock,
      findMany: turnFindManyMock,
    },
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

const SOKO_BOT_ID = "01960001-0001-7001-8001-000000000001";

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
    turnFindFirstMock.mockResolvedValue(null);
    turnFindManyMock.mockResolvedValue([]);
    usageFindManyMock.mockResolvedValue([]);
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
    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).rejects.toBeInstanceOf(SokoBotBillingAccessError);

    subscriptionMock.mockResolvedValue({ plan: "starter" });
    balanceMock.mockResolvedValue(0n);
    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).rejects.toThrow("Insufficient personal credits");
  });

  it("requires enough balance for the most expensive of the last three completed turns", async () => {
    subscriptionMock.mockResolvedValue({ plan: "starter" });
    balanceMock.mockResolvedValue(convertCreditsToCents(50));
    turnFindManyMock.mockResolvedValue([
      { id: "turn_3" },
      { id: "turn_2" },
      { id: "turn_1" },
    ]);
    usageFindManyMock.mockResolvedValue([
      { referenceId: "turn_3", cents: convertCreditsToCents(75) },
      { referenceId: "turn_2", cents: convertCreditsToCents(20) },
      { referenceId: "turn_1", cents: convertCreditsToCents(10) },
    ]);

    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).rejects.toThrow("Insufficient personal credits");
    expect(turnFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ take: 3 }),
    );

    balanceMock.mockResolvedValue(convertCreditsToCents(75));
    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).resolves.toBeUndefined();
  });

  it("blocks another turn until balance covers the prior unpaid remainder", async () => {
    subscriptionMock.mockResolvedValue({ plan: "starter" });
    balanceMock.mockResolvedValue(convertCreditsToCents(94));
    turnFindFirstMock.mockResolvedValue({
      id: "turn_shortfall",
      costUsdMicros: 1_000_000n,
    });
    usageFindUniqueMock.mockResolvedValue({
      cents: convertCreditsToCents(5),
    });

    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).rejects.toBeInstanceOf(SokoBotBillingAccessError);

    balanceMock.mockResolvedValue(convertCreditsToCents(95));
    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).resolves.toBeUndefined();
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
