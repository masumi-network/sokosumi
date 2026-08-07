import {
  AgentEntryType,
  AgentStatus,
  type CreditCost,
  PaymentType,
  PricingType,
  type Prisma,
} from "@sokosumi/database";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_PRICING_READ_TRANSACTION_OPTIONS,
  buildAvailableAgentWhereClause,
  calculateAgentRating,
  calculateAgentRatings,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
  getRecentAgentReviews,
  getUserAgentReview,
  isCardanoV2SourceReady,
  requireAvailableAgentOrThrow,
  toMasumiAgent,
  toMasumiAgentForJob,
  upsertUserAgentReview,
} from "./agent";

const CARDANO_V2_READY_SOURCE = {
  policyId: "ab".repeat(28),
  smartContractAddress: "addr_test1_v2_contract",
};

const { getEnvMock } = vi.hoisted(() => ({
  // Default is set here (not only in beforeEach) because `@/lib/db/prisma`
  // reads getEnv().DATABASE_URL at module load, before any hook runs.
  getEnvMock: vi.fn().mockReturnValue({
    DATABASE_URL: "https://example.com/database",
  }),
}));

vi.mock("@/config/env", () => ({
  getEnv: getEnvMock,
}));

function createCreditCost(unit: string): CreditCost {
  const now = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `credit-cost-${unit}`,
    createdAt: now,
    updatedAt: now,
    unit,
    centsPerUnit: BigInt(1),
  };
}

function createTransactionClient(creditCosts: CreditCost[]) {
  return {
    creditCost: {
      findMany: vi.fn().mockResolvedValue(creditCosts),
    },
  } as unknown as Prisma.TransactionClient;
}

describe("AGENT_PRICING_READ_TRANSACTION_OPTIONS", () => {
  it("pins agent pricing reads to a single snapshot", () => {
    // Prisma loads `include`d relations as separate statements, so at READ
    // COMMITTED a registry replay landing mid-read returns FIXED pricing whose
    // amount rows are already deleted — and an empty amount set totals to zero
    // credits. Only a shared snapshot prevents that; no write-side change can,
    // because the skew is between the reader's own statements.
    expect(AGENT_PRICING_READ_TRANSACTION_OPTIONS).toEqual({
      isolationLevel: "RepeatableRead",
    });
  });
});

describe("buildAvailableAgentWhereClause", () => {
  it("does not include organization allowlist or denylist filters", () => {
    const where = buildAvailableAgentWhereClause([createCreditCost("USD")], []);

    expect(Object.prototype.hasOwnProperty.call(where, "OR")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(where, "NOT")).toBe(false);
    expect(where.status).toBe(AgentStatus.ONLINE);
    expect(where.isShown).toBe(true);
  });

  it("requires fixed pricing to have at least one billable amount row", () => {
    const where = buildAvailableAgentWhereClause(
      [createCreditCost("USD"), createCreditCost("EUR")],
      [],
    );

    expect(where.pricing).toEqual({
      pricingType: { not: PricingType.UNKNOWN },
      OR: [
        { pricingType: PricingType.FREE },
        {
          pricingType: PricingType.FIXED,
          fixedPricing: {
            amounts: {
              every: {
                unit: { in: ["USD", "EUR"] },
              },
              // `every` alone is vacuously true while a registry replay has
              // deleted the amount rows; such an agent would be counted but
              // then dropped from the page by buildAgentSummaries.
              some: {
                unit: { in: ["USD", "EUR"] },
              },
            },
          },
        },
      ],
    });
  });

  it("excludes pointer types, endpointless, unknown-rail, and V2-contract agents when the rail is not ready", () => {
    const where = buildAvailableAgentWhereClause([createCreditCost("USD")], []);

    expect(where.type).toBe(AgentEntryType.STANDARD);
    // Allowlist: UNKNOWN rails are never available; V2 only when ready.
    expect(where.paymentType).toEqual({
      in: [PaymentType.WEB3_CARDANO_V1, PaymentType.NONE],
    });
    // Endpoint requirement accepts a metadata-override URL, and V2-POLICY
    // rows are excluded by identifier — free/EVM-only V2 entries report
    // paymentType "None", so the allowlist alone would let them through.
    expect(where.AND).toEqual([
      {
        OR: [
          { apiBaseUrl: { not: null } },
          { metadataOverride: { apiBaseUrl: { not: null } } },
        ],
      },
      {
        NOT: {
          OR: [
            { paymentType: PaymentType.WEB3_CARDANO_V2 },
            {
              blockchainIdentifier: {
                startsWith:
                  "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b",
              },
            },
          ],
        },
      },
    ]);
  });

  it("allowlists V2-contract agents when the rail reports a purchase-ready source", () => {
    const where = buildAvailableAgentWhereClause(
      [createCreditCost("USD")],
      [CARDANO_V2_READY_SOURCE],
    );

    expect(where.paymentType).toEqual({
      in: [
        PaymentType.WEB3_CARDANO_V1,
        PaymentType.NONE,
        PaymentType.WEB3_CARDANO_V2,
      ],
    });
    // Structural filters stay regardless of rail readiness.
    expect(where.type).toBe(AgentEntryType.STANDARD);
    expect(where.AND).toHaveLength(2);
    expect(where.AND).toContainEqual({
      OR: [
        {
          NOT: {
            OR: [
              { paymentType: PaymentType.WEB3_CARDANO_V2 },
              {
                blockchainIdentifier: {
                  startsWith:
                    "67ab0c92c4ac1610895a1c965ee50aba41a8f1513b15240723b3bd0b",
                },
              },
            ],
          },
        },
        {
          blockchainIdentifier: { startsWith: "ab".repeat(28) },
          paymentSources: {
            some: {
              chain: "Cardano",
              network: undefined,
              paymentSourceType: "Web3CardanoV2",
              address: "addr_test1_v2_contract",
            },
          },
        },
      ],
    });
  });

  it("excludes V2-contract agents when the rail reports no purchase-ready source", () => {
    const where = buildAvailableAgentWhereClause([createCreditCost("USD")], []);

    expect(where.paymentType).toEqual({
      in: [PaymentType.WEB3_CARDANO_V1, PaymentType.NONE],
    });
  });
});

describe("getCardanoV2ReadySources", () => {
  function createSyncMetadataTransactionClient(
    row: { cursorId: string; lastSyncedAt: Date } | null,
  ) {
    const findUnique = vi.fn().mockResolvedValue(row);
    const tx = {
      syncMetadata: {
        findUnique,
      },
    } as unknown as Prisma.TransactionClient;
    return { tx, findUnique };
  }

  it("returns exact sources from a fresh cache row", async () => {
    const { tx, findUnique } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([CARDANO_V2_READY_SOURCE]),
      lastSyncedAt: new Date(),
    });

    await expect(getCardanoV2ReadySources(tx)).resolves.toEqual([
      CARDANO_V2_READY_SOURCE,
    ]);
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: "cardano-v2-rail-readiness" },
    });
  });

  it("returns no sources when the cached readiness is empty", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: "[]",
      lastSyncedAt: new Date(),
    });

    await expect(getCardanoV2ReadySources(tx)).resolves.toEqual([]);
  });

  it("returns no sources when no readiness row exists yet", async () => {
    const { tx } = createSyncMetadataTransactionClient(null);

    await expect(getCardanoV2ReadySources(tx)).resolves.toEqual([]);
  });

  it("fails closed when the ready row is older than the TTL", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([CARDANO_V2_READY_SOURCE]),
      lastSyncedAt: new Date(Date.now() - 31 * 60 * 1000),
    });

    await expect(getCardanoV2ReadySources(tx)).resolves.toEqual([]);
  });

  it("fails closed for a legacy boolean readiness payload", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: "ready",
      lastSyncedAt: new Date(),
    });

    await expect(getCardanoV2ReadySources(tx)).resolves.toEqual([]);
  });

  it("drops cached sources with malformed policy ids", async () => {
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([
        {
          policyId: "too-short",
          smartContractAddress: "addr_test1_v2_contract",
        },
      ]),
      lastSyncedAt: new Date(),
    });

    await expect(getCardanoV2ReadySources(tx)).resolves.toEqual([]);
  });
});

describe("isCardanoV2SourceReady", () => {
  it("requires the exact policy and contract pair", () => {
    const identifier = `${CARDANO_V2_READY_SOURCE.policyId}${"ab".repeat(32)}`;

    expect(
      isCardanoV2SourceReady(
        identifier,
        CARDANO_V2_READY_SOURCE.smartContractAddress,
        [CARDANO_V2_READY_SOURCE],
      ),
    ).toBe(true);
    expect(
      isCardanoV2SourceReady(
        identifier,
        CARDANO_V2_READY_SOURCE.smartContractAddress,
        [
          {
            ...CARDANO_V2_READY_SOURCE,
            policyId: "cd".repeat(28),
          },
        ],
      ),
    ).toBe(false);
  });

  it("normalizes identifier and contract casing", () => {
    expect(
      isCardanoV2SourceReady(
        `${CARDANO_V2_READY_SOURCE.policyId}${"ab".repeat(32)}`.toUpperCase(),
        CARDANO_V2_READY_SOURCE.smartContractAddress.toUpperCase(),
        [CARDANO_V2_READY_SOURCE],
      ),
    ).toBe(true);
  });
});

describe("toMasumiAgent", () => {
  const baseAgent = {
    id: "agent-1",
    name: "Agent One",
    blockchainIdentifier: "chain-1",
    apiBaseUrl: "https://agent.example.com",
  };

  it("throws a 422 when neither registry nor override provides an API endpoint", () => {
    expect(() =>
      toMasumiAgent({ ...baseAgent, apiBaseUrl: null, metadataOverride: null }),
    ).toThrowError("Agent has no API endpoint");

    try {
      toMasumiAgent({
        ...baseAgent,
        apiBaseUrl: null,
        metadataOverride: { apiBaseUrl: null },
      });
      expect.unreachable("expected toMasumiAgent to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(422);
    }
  });

  it("falls back to the override URL when the registry apiBaseUrl is null", () => {
    const result = toMasumiAgent({
      ...baseAgent,
      apiBaseUrl: null,
      metadataOverride: { apiBaseUrl: "https://override.example.com" },
    });

    expect(result).toEqual({
      id: "agent-1",
      name: "Agent One",
      blockchainIdentifier: "chain-1",
      apiBaseUrl: "https://override.example.com",
      metadataOverride: { apiBaseUrl: "https://override.example.com" },
    });
  });

  it("prefers the metadata override over the registry apiBaseUrl", () => {
    const result = toMasumiAgent({
      ...baseAgent,
      metadataOverride: { apiBaseUrl: "https://override.example.com" },
    });

    expect(result.apiBaseUrl).toBe("https://override.example.com");
  });
});

describe("toMasumiAgentForJob", () => {
  const agent = {
    id: "agent-1",
    name: "Agent One",
    blockchainIdentifier: "current-chain",
    apiBaseUrl: "https://current.example.com",
    metadataOverride: { apiBaseUrl: "https://current-override.example.com" },
  };

  it("uses the immutable job snapshot instead of the current revision", () => {
    expect(
      toMasumiAgentForJob({
        agent,
        agentBlockchainIdentifier: "started-chain",
        agentApiBaseUrl: "https://started.example.com",
      }),
    ).toEqual({
      id: "agent-1",
      name: "Agent One",
      blockchainIdentifier: "started-chain",
      apiBaseUrl: "https://started.example.com",
      metadataOverride: null,
    });
  });

  it("falls back to the current effective endpoint for legacy jobs", () => {
    const result = toMasumiAgentForJob({
      agent,
      agentBlockchainIdentifier: null,
      agentApiBaseUrl: null,
    });

    expect(result.blockchainIdentifier).toBe("current-chain");
    expect(result.apiBaseUrl).toBe("https://current-override.example.com");
  });
});

describe("getCreditCostsOrThrow", () => {
  it("returns credit costs when available", async () => {
    const creditCosts = [createCreditCost("USD"), createCreditCost("EUR")];
    const tx = createTransactionClient(creditCosts);

    const result = await getCreditCostsOrThrow(tx);
    expect(result).toEqual(creditCosts);
  });

  it("throws when no credit costs are configured", async () => {
    const tx = createTransactionClient([]);

    await expect(getCreditCostsOrThrow(tx)).rejects.toThrow(
      "Failed to get credit information for agents",
    );
  });
});

describe("calculateAgentRating", () => {
  it("filters hidden ratings from public aggregates", async () => {
    const aggregate = vi.fn().mockResolvedValue({
      _count: { rating: 2 },
      _avg: { rating: 4.5 },
    });
    const tx = {
      userAgentRating: {
        aggregate,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await calculateAgentRating("agent-1", tx);

    expect(aggregate).toHaveBeenCalledWith({
      where: {
        agentId: "agent-1",
        isHidden: false,
      },
      _count: { rating: true },
      _avg: { rating: true },
    });
    expect(result).toEqual({
      total: 2,
      average: 4.5,
    });
  });
});

describe("calculateAgentRatings", () => {
  it("filters hidden ratings from grouped aggregates", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      {
        agentId: "agent-1",
        _count: { rating: 3 },
        _avg: { rating: 4 },
      },
    ]);
    const tx = {
      userAgentRating: {
        groupBy,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await calculateAgentRatings(["agent-1", "agent-2"], tx);

    expect(groupBy).toHaveBeenCalledWith({
      by: ["agentId"],
      where: {
        agentId: { in: ["agent-1", "agent-2"] },
        isHidden: false,
      },
      _count: { rating: true },
      _avg: { rating: true },
    });
    expect(result).toEqual(
      new Map([
        [
          "agent-1",
          {
            total: 3,
            average: 4,
          },
        ],
        [
          "agent-2",
          {
            total: 0,
            average: null,
          },
        ],
      ]),
    );
  });

  it("returns zero defaults when only hidden ratings exist", async () => {
    const groupBy = vi.fn().mockResolvedValue([]);
    const tx = {
      userAgentRating: {
        groupBy,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await calculateAgentRatings(["agent-1"], tx);

    expect(result).toEqual(
      new Map([
        [
          "agent-1",
          {
            total: 0,
            average: null,
          },
        ],
      ]),
    );
  });
});

describe("getRecentAgentReviews", () => {
  it("filters out ratings without meaningful comments", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "rating-1",
        rating: 5,
        comment: "Helpful review",
        createdAt: new Date("2026-03-17T10:00:00.000Z"),
        updatedAt: new Date("2026-03-17T10:00:00.000Z"),
        user: {
          id: "user-1",
          name: "Jane Doe",
          image: "https://example.com/avatar.png",
        },
      },
    ]);
    const tx = {
      userAgentRating: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await getRecentAgentReviews("agent-1", 10, tx);

    expect(findMany).toHaveBeenCalledWith({
      where: {
        agentId: "agent-1",
        isHidden: false,
        AND: [{ comment: { not: null } }, { comment: { not: "" } }],
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      skip: 0,
    });
    expect(result).toEqual([
      {
        id: "rating-1",
        rating: 5,
        comment: "Helpful review",
        createdAt: "2026-03-17T10:00:00.000Z",
        updatedAt: "2026-03-17T10:00:00.000Z",
        user: {
          id: "user-1",
          name: "Jane Doe",
          image: "https://example.com/avatar.png",
        },
      },
    ]);
  });

  it("forwards the offset as a skip", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const tx = {
      userAgentRating: {
        findMany,
      },
    } as unknown as Prisma.TransactionClient;

    await getRecentAgentReviews("agent-1", 5, tx, 10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5, skip: 10 }),
    );
  });
});

describe("getUserAgentReview", () => {
  it("returns the caller's own rating, ignoring the hidden filter", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "rating-1",
      rating: 4,
      comment: "Mine",
      createdAt: new Date("2026-03-17T10:00:00.000Z"),
      updatedAt: new Date("2026-03-17T10:00:00.000Z"),
      isHidden: true,
    });
    const tx = {
      userAgentRating: {
        findUnique,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await getUserAgentReview("agent-1", "user-1", tx);

    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_agentId: {
          userId: "user-1",
          agentId: "agent-1",
        },
      },
    });
    // createdAt/updatedAt are intentionally dropped from the my-review payload
    // (see agentMyReviewSchema); the schema parse strips them.
    expect(result).toEqual({
      id: "rating-1",
      rating: 4,
      comment: "Mine",
    });
  });

  it("returns null when the caller has not rated the agent", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const tx = {
      userAgentRating: {
        findUnique,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await getUserAgentReview("agent-1", "user-1", tx);

    expect(result).toBeNull();
  });
});

describe("requireAvailableAgentOrThrow", () => {
  it("resolves when an available agent exists", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "agent-1" });
    const tx = {
      creditCost: {
        findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
      },
      syncMetadata: { findUnique: vi.fn().mockResolvedValue(null) },
      agent: { findFirst },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireAvailableAgentOrThrow("agent-1", tx),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "agent-1" }),
        select: { id: true },
      }),
    );
  });

  it("throws a 404 when no available agent matches", async () => {
    const tx = {
      creditCost: {
        findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
      },
      syncMetadata: { findUnique: vi.fn().mockResolvedValue(null) },
      agent: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as Prisma.TransactionClient;

    await expect(
      requireAvailableAgentOrThrow("missing", tx),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("upsertUserAgentReview", () => {
  it("upserts the caller's rating and returns the my-review payload", async () => {
    const upsert = vi.fn().mockResolvedValue({
      id: "rating-1",
      rating: 5,
      comment: "Great",
      createdAt: new Date("2026-03-17T10:00:00.000Z"),
      updatedAt: new Date("2026-03-17T10:00:00.000Z"),
    });
    const tx = {
      userAgentRating: {
        upsert,
      },
    } as unknown as Prisma.TransactionClient;

    const result = await upsertUserAgentReview(
      "agent-1",
      "user-1",
      5,
      "Great",
      tx,
    );

    expect(upsert).toHaveBeenCalledWith({
      where: { userId_agentId: { userId: "user-1", agentId: "agent-1" } },
      update: { rating: 5, comment: "Great" },
      create: {
        userId: "user-1",
        agentId: "agent-1",
        rating: 5,
        comment: "Great",
      },
    });
    // createdAt/updatedAt are stripped by agentMyReviewSchema.
    expect(result).toEqual({ id: "rating-1", rating: 5, comment: "Great" });
  });
});
