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
  getAgentApiBaseUrl,
  getAgentAuthorImage,
  getAgentDescription,
  getAgentIcon,
  getAgentImage,
  getAgentName,
  getCardanoV2ReadySources,
  getCreditCostsOrThrow,
  getJobDetailsAgentOverrideFields,
  isCardanoV2SourceReady,
  requireAvailableAgentOrThrow,
  toMasumiAgent,
  toMasumiAgentForJob,
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
                unit: { in: ["USD", "usd", "EUR", "eur"] },
              },
              // `every` alone is vacuously true while a registry replay has
              // deleted the amount rows; such an agent would be counted but
              // then dropped from the page by buildAgentSummaries.
              some: {
                unit: { in: ["USD", "usd", "EUR", "eur"] },
              },
            },
          },
        },
      ],
    });
  });

  it("matches a credit cost against both the stored and the normalized unit spelling", () => {
    // Ingestion normalizes every stored unit (lowercased), but CreditCost.unit
    // is free-form operator input and rows ingested before that change kept
    // the registry's casing — isSameAgentPricing treats a pure case change as
    // "unchanged", so they are never rewritten. Prisma `in` is case-sensitive,
    // so matching one spelling drops the other's agents in SQL, with no
    // buildAgentSummaries skip and no log line to notice it by.
    const upperCaseAssetUnit =
      "C48CBB3D5E57ED56E276BC45F99AB39ABE94E6CD7AC39FB402DA47AD0014DF105553444D";
    const where = buildAvailableAgentWhereClause(
      [createCreditCost(upperCaseAssetUnit)],
      [],
    );

    const fixedBranch = (
      where.pricing as {
        OR: {
          fixedPricing?: { amounts: { some: { unit: { in: string[] } } } };
        }[];
      }
    ).OR[1];
    expect(fixedBranch.fixedPricing?.amounts.some.unit.in).toEqual([
      upperCaseAssetUnit,
      upperCaseAssetUnit.toLowerCase(),
    ]);
  });

  it("excludes CAIP-19 credit-cost units from the billable unit match", () => {
    // CAIP-19 rows price per WHOLE token (x402 convention); the Cardano
    // pricing path bills per SMALLEST unit. A CAIP-19-keyed CreditCost row
    // must never make a Cardano agent billable — it would price 10^decimals×
    // wrong in getAgentCost.
    const caip19Unit =
      "eip155:84532/erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e";
    const where = buildAvailableAgentWhereClause(
      [createCreditCost("USD"), createCreditCost(caip19Unit)],
      [],
    );

    const fixedBranch = (
      where.pricing as {
        OR: {
          fixedPricing?: { amounts: { some: { unit: { in: string[] } } } };
        }[];
      }
    ).OR[1];
    expect(fixedBranch.fixedPricing?.amounts.some.unit.in).toEqual([
      "USD",
      "usd",
    ]);
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

  it("keeps serving readiness that has not been refreshed for a long time", async () => {
    // Readiness is static configuration — the node derives it from config
    // presence, never from balance or load — so an old value is almost
    // certainly still true. Expiring it would let our own cron falling behind
    // take the entire V2 catalog down, which says nothing about whether V2
    // can settle.
    const { tx } = createSyncMetadataTransactionClient({
      cursorId: JSON.stringify([CARDANO_V2_READY_SOURCE]),
      lastSyncedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    });

    await expect(getCardanoV2ReadySources(tx)).resolves.toEqual([
      CARDANO_V2_READY_SOURCE,
    ]);
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

describe("getAgentImage", () => {
  it("prefers the override image and resolves ipfs URLs", () => {
    expect(
      getAgentImage({
        image: "https://registry.example.com/image.png",
        metadataOverride: { image: "ipfs://bafyoverride" },
      }),
    ).toBe("https://c-ipfs-gw.nmkr.io/ipfs/bafyoverride");
  });

  it("falls back to the registry image and returns null when absent", () => {
    expect(
      getAgentImage({
        image: "https://registry.example.com/image.png",
        metadataOverride: null,
      }),
    ).toBe("https://registry.example.com/image.png");
    expect(getAgentImage({ image: null, metadataOverride: null })).toBeNull();
  });
});

describe("getAgentIcon", () => {
  it("resolves the icon URL and returns null when absent", () => {
    expect(getAgentIcon({ icon: "ipfs://bafyicon" })).toBe(
      "https://c-ipfs-gw.nmkr.io/ipfs/bafyicon",
    );
    expect(getAgentIcon({ icon: null })).toBeNull();
  });
});

describe("getAgentName", () => {
  it("prefers the override name over the registry name", () => {
    expect(
      getAgentName({
        name: "Registry Name",
        metadataOverride: { name: "Override Name" },
      }),
    ).toBe("Override Name");
    expect(
      getAgentName({ name: "Registry Name", metadataOverride: null }),
    ).toBe("Registry Name");
  });
});

describe("getAgentDescription", () => {
  it("prefers the override description over the registry description", () => {
    expect(
      getAgentDescription({
        description: "Registry description",
        metadataOverride: { description: "Override description" },
      }),
    ).toBe("Override description");
    expect(
      getAgentDescription({ description: null, metadataOverride: null }),
    ).toBeNull();
  });
});

describe("getAgentAuthorImage", () => {
  it("prefers the override author image and resolves ipfs URLs", () => {
    expect(
      getAgentAuthorImage({
        authorImage: "https://registry.example.com/author.png",
        metadataOverride: { authorImage: "ipfs://bafyauthor" },
      }),
    ).toBe("https://c-ipfs-gw.nmkr.io/ipfs/bafyauthor");
    expect(
      getAgentAuthorImage({ authorImage: null, metadataOverride: null }),
    ).toBeNull();
  });
});

describe("getAgentApiBaseUrl", () => {
  it("prefers the override endpoint over the registry endpoint", () => {
    expect(
      getAgentApiBaseUrl({
        apiBaseUrl: "https://registry.example.com",
        metadataOverride: { apiBaseUrl: "https://override.example.com" },
      }),
    ).toBe("https://override.example.com");
    expect(
      getAgentApiBaseUrl({ apiBaseUrl: null, metadataOverride: null }),
    ).toBeNull();
  });
});

describe("getJobDetailsAgentOverrideFields", () => {
  it("maps every override field and nulls the rest", () => {
    expect(
      getJobDetailsAgentOverrideFields({
        metadataOverride: {
          name: "Override Name",
          image: "ipfs://bafyoverride",
          legalPrivacyPolicy: "Privacy",
          legalTerms: null,
          legalDpa: null,
          legalOther: null,
        },
      }),
    ).toEqual({
      overrideName: "Override Name",
      overrideImage: "ipfs://bafyoverride",
      overrideLegalPrivacyPolicy: "Privacy",
      overrideLegalTerms: null,
      overrideLegalDpa: null,
      overrideLegalOther: null,
    });
    expect(
      getJobDetailsAgentOverrideFields({ metadataOverride: null }),
    ).toEqual({
      overrideName: null,
      overrideImage: null,
      overrideLegalPrivacyPolicy: null,
      overrideLegalTerms: null,
      overrideLegalDpa: null,
      overrideLegalOther: null,
    });
  });
});
