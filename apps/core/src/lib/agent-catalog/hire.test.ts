import { describe, expect, it, vi } from "vitest";
import type { NetworkScope } from "@/lib/db/network-scope";
import { requireAgentForHire } from "./hire";

describe("requireAgentForHire", () => {
  it("reads the Agent in a Repeatable Read batch on the scope's Network side", async () => {
    const findFirst = vi.fn().mockReturnValue(null);
    const netBatch = vi.fn(async (build: (db: unknown) => unknown[]) =>
      Promise.all(build({ agent: { findFirst } })),
    );
    const scope = {
      network: "mainnet",
      networkDb: {
        creditCost: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ unit: "lovelace", centsPerUnit: 1n }]),
        },
      },
      sharedDb: {
        syncMetadata: { findUnique: vi.fn().mockResolvedValue(null) },
      },
      netBatch,
    } as unknown as NetworkScope;

    await expect(requireAgentForHire(scope, "agent-1", null)).rejects.toThrow(
      "Agent not found",
    );
    expect(netBatch).toHaveBeenCalledWith(
      expect.any(Function),
      "RepeatableRead",
    );
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it("returns the rates it priced with and the ready sources it read", async () => {
    const rates = [{ unit: "lovelace", centsPerUnit: 1n }];
    const ready = [
      { policyId: "ab".repeat(28), smartContractAddress: "addr_test1_ready" },
    ];
    const agent = {
      id: "agent-1",
      paymentType: "NONE",
      blockchainIdentifier: "agent-1",
      pricing: { pricingType: "FREE", fixedPricing: null },
      paymentSources: [],
    };
    const scope = {
      network: "mainnet",
      networkDb: { creditCost: { findMany: vi.fn().mockResolvedValue(rates) } },
      sharedDb: {
        syncMetadata: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ cursorId: JSON.stringify(ready) }),
        },
      },
      netBatch: vi.fn().mockResolvedValue([agent]),
    } as unknown as NetworkScope;

    const hire = await requireAgentForHire(scope, "agent-1", null);

    expect(hire.creditCosts).toBe(rates);
    expect(hire.cardanoV2ReadySources).toEqual(ready);
    expect(hire.agent).toBe(agent);
    expect(hire.cost).toEqual({ cents: 0n });
  });
});
