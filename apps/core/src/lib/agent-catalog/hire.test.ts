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
});
