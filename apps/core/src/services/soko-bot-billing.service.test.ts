import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  balanceMock,
  botFindUniqueMock,
  getEnvMock,
  postNoticeMock,
  prepareConsumptionMock,
  usageCreateMock,
  usageFindManyMock,
  usageFindUniqueMock,
  turnFindFirstMock,
  turnFindManyMock,
  transactionCreateMock,
} = vi.hoisted(() => ({
  balanceMock: vi.fn(),
  botFindUniqueMock: vi.fn(),
  postNoticeMock: vi.fn(),
  getEnvMock: vi.fn(),
  prepareConsumptionMock: vi.fn(),
  usageCreateMock: vi.fn(),
  usageFindManyMock: vi.fn(),
  usageFindUniqueMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
  turnFindManyMock: vi.fn(),
  transactionCreateMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findUnique: botFindUniqueMock },
    sokoBotUsage: {
      findMany: usageFindManyMock,
      findUnique: usageFindUniqueMock,
    },
    sokoBotTurn: {
      findFirst: turnFindFirstMock,
      findMany: turnFindManyMock,
    },
  },
}));
vi.mock("@/services/soko-bot-chat.service", () => ({
  postSokoBotOwnerNotice: postNoticeMock,
}));
vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    getBalance: balanceMock,
    prepareConsumption: prepareConsumptionMock,
  },
}));

import { convertCreditsToCents } from "@sokosumi/utils";

import {
  notifySokoBotOutOfCredits,
  recordSokoBotTurnUsage,
  requireSokoBotTurnFunding,
  SokoBotBillingAccessError,
  sokoBotUsageCents,
} from "@/services/soko-bot-billing.service";

const SOKO_BOT_ID = "01960001-0001-7001-8001-000000000001";

function transactionClient() {
  return {
    sokoBot: { findUnique: botFindUniqueMock },
    sokoBotUsage: {
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
    turnFindFirstMock.mockResolvedValue(null);
    turnFindManyMock.mockResolvedValue([]);
    usageFindManyMock.mockResolvedValue([]);
    botFindUniqueMock.mockResolvedValue({
      workspace: { organizationId: null },
    });
  });

  it("maps runtime USD usage to configured credits with a minimum", () => {
    expect(sokoBotUsageCents(500n)).toBe(convertCreditsToCents(0.1));
    expect(sokoBotUsageCents(2_000_000n)).toBe(convertCreditsToCents(200));
    expect(sokoBotUsageCents(0n)).toBe(0n);
  });

  it("bills the minimum for a turn that spent tokens but reported no cost", () => {
    // Otherwise such a turn is free and never reaches the credit history.
    expect(sokoBotUsageCents(0n, true)).toBe(convertCreditsToCents(0.1));
    expect(sokoBotUsageCents(0n, false)).toBe(0n);
  });

  it("lets a free user start a turn with enough personal credits", async () => {
    balanceMock.mockResolvedValue(0n);
    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).rejects.toThrow("Insufficient personal credits");

    balanceMock.mockResolvedValue(convertCreditsToCents(1));
    await expect(
      requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
    ).resolves.toBeUndefined();
  });

  it("requires enough balance for the most expensive of the last three completed turns", async () => {
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

  describe("in an organization workspace", () => {
    beforeEach(() => {
      botFindUniqueMock.mockResolvedValue({
        workspace: { organizationId: "org_1" },
      });
    });

    it("charges the organization's credits", async () => {
      const expected = convertCreditsToCents(100);
      usageFindUniqueMock.mockResolvedValue(null);
      balanceMock.mockResolvedValue(expected);
      prepareConsumptionMock.mockResolvedValue([
        { bucketId: "bucket_org", amount: expected },
      ]);
      transactionCreateMock.mockResolvedValue({ id: "transaction_1" });

      await recordSokoBotTurnUsage(
        {
          turnId: "turn_1",
          sokoBotId: SOKO_BOT_ID,
          userId: "user_1",
          costUsdMicros: 1_000_000n,
        },
        transactionClient() as never,
      );

      expect(balanceMock).toHaveBeenCalledWith(
        "user_1",
        "org_1",
        expect.anything(),
      );
      expect(prepareConsumptionMock).toHaveBeenCalledWith(
        "user_1",
        "org_1",
        expected,
        expect.anything(),
      );
      expect(transactionCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: "org_1" }),
        }),
      );
      expect(usageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: "org_1" }),
        }),
      );
    });

    it("lets the organization's balance cover a prior unpaid remainder", async () => {
      turnFindFirstMock.mockResolvedValue({
        id: "turn_shortfall",
        costUsdMicros: 1_000_000n,
      });
      usageFindUniqueMock.mockResolvedValue({
        cents: convertCreditsToCents(5),
      });
      balanceMock.mockImplementation(
        async (_userId: string, organizationId: string | null) =>
          organizationId === "org_1" ? convertCreditsToCents(500) : 0n,
      );

      await expect(
        requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
      ).resolves.toBeUndefined();

      balanceMock.mockResolvedValue(convertCreditsToCents(10));
      await expect(
        requireSokoBotTurnFunding("user_1", SOKO_BOT_ID),
      ).rejects.toThrow("Insufficient organization credits to cover");
    });
  });

  it("names the payer in a pause notice keyed to the day", async () => {
    const now = new Date("2026-10-01T09:00:00.000Z");
    botFindUniqueMock.mockResolvedValue({
      workspace: { organization: { name: "utxo AG" } },
    });
    await notifySokoBotOutOfCredits(SOKO_BOT_ID, now);
    expect(postNoticeMock).toHaveBeenLastCalledWith({
      sokoBotId: SOKO_BOT_ID,
      content: "I'm paused: utxo AG is out of credits.",
      key: `out-of-credits:${SOKO_BOT_ID}:2026-10-01`,
    });

    botFindUniqueMock.mockResolvedValue({ workspace: { organization: null } });
    await notifySokoBotOutOfCredits(SOKO_BOT_ID, now);
    expect(postNoticeMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: "I'm paused: you're out of credits.",
      }),
    );
  });
});
