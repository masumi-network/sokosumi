import type { CreditCost } from "@sokosumi/database";
import { describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import {
  createRefusedNetworkScope,
  type NetworkDb,
  type NetworkScope,
} from "@/lib/db/network-scope";
import { requireAvailableAgent } from "./availability";
import { listCategoriesInUse } from "./categories";
import { getAgentEndpoint } from "./endpoint";

vi.mock("@/config/env", () => ({
  getEnv: () => ({ NETWORK: "Mainnet" }),
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

describe("requireAvailableAgent", () => {
  it("resolves on the scope when an available agent exists", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "agent-1" });
    const findUnique = vi.fn().mockResolvedValue(null);
    const scope = {
      network: "mainnet",
      networkDb: {
        creditCost: {
          findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
        },
        agent: { findFirst },
      },
      sharedDb: {
        syncMetadata: { findUnique },
      },
    } as unknown as NetworkScope;

    await expect(
      requireAvailableAgent(scope, "agent-1"),
    ).resolves.toBeUndefined();
    expect(findUnique).toHaveBeenCalledWith({
      where: { key: "cardano-v2-rail-readiness" },
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "agent-1" }),
        select: { id: true },
      }),
    );
  });

  it("throws 404 when no available agent matches", async () => {
    const scope = {
      network: "mainnet",
      networkDb: {
        creditCost: {
          findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
        },
        agent: { findFirst: vi.fn().mockResolvedValue(null) },
      },
      sharedDb: {
        syncMetadata: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    } as unknown as NetworkScope;

    await expect(requireAvailableAgent(scope, "missing")).rejects.toMatchObject(
      { status: 404 },
    );
  });

  it("reads readiness on the caller's Network transaction via raw SQL when tx is passed", async () => {
    const policyId = "ab".repeat(28);
    const smartContractAddress = "addr_test1_tx_v2";
    const queryRaw = vi.fn().mockResolvedValue([
      {
        cursorId: JSON.stringify([{ policyId, smartContractAddress }]),
      },
    ]);
    const findFirst = vi.fn().mockResolvedValue({ id: "agent-1" });
    const sharedFindUnique = vi.fn();
    const tx = {
      creditCost: {
        findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
      },
      agent: { findFirst },
      $queryRaw: queryRaw,
    } as unknown as NetworkDb;
    const scope = {
      network: "preprod",
      sharedDb: { syncMetadata: { findUnique: sharedFindUnique } },
    } as unknown as NetworkScope;

    await expect(
      requireAvailableAgent(scope, "agent-1", tx),
    ).resolves.toBeUndefined();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sharedFindUnique).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  blockchainIdentifier: { startsWith: policyId },
                  paymentSources: {
                    some: expect.objectContaining({
                      address: smartContractAddress,
                    }),
                  },
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it("refuses before touching sharedDb on a refused scope", async () => {
    const refused = createRefusedNetworkScope(
      forbidden("Preprod is switched off"),
    );

    await expect(
      requireAvailableAgent(refused, "agent-1"),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("listCategoriesInUse", () => {
  it("queries categories with available agents in priority and name order", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const scope = {
      network: "mainnet",
      networkDb: {
        creditCost: {
          findMany: vi.fn().mockResolvedValue([createCreditCost("USD")]),
        },
        category: { findMany },
      },
      sharedDb: {
        syncMetadata: { findUnique: vi.fn().mockResolvedValue(null) },
      },
    } as unknown as NetworkScope;

    await expect(listCategoriesInUse(scope)).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { agents: { some: expect.any(Object) } },
      orderBy: [{ priority: "asc" }, { name: "asc" }],
    });
  });

  it("refuses before reading on a refused scope", async () => {
    const refused = createRefusedNetworkScope(
      forbidden("Preprod is switched off"),
    );

    await expect(listCategoriesInUse(refused)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("getAgentEndpoint", () => {
  it("looks up the agent endpoint fields by id on the scope", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "agent-1",
      name: "Agent One",
      blockchainIdentifier: "chain-1",
      apiBaseUrl: "https://agent.example.com",
      metadataOverride: null,
    });
    const scope = {
      network: "mainnet",
      networkDb: { agent: { findUnique } },
    } as unknown as NetworkScope;

    await expect(getAgentEndpoint(scope, "agent-1")).resolves.toMatchObject({
      id: "agent-1",
      apiBaseUrl: "https://agent.example.com",
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "agent-1" },
      select: {
        id: true,
        name: true,
        blockchainIdentifier: true,
        apiBaseUrl: true,
        metadataOverride: {
          select: {
            apiBaseUrl: true,
          },
        },
      },
    });
  });
});
