import { beforeEach, describe, expect, it, vi } from "vitest";

const getX402AgentsMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
}));

vi.mock("@/lib/clients/core.catalog.client", () => ({
  coreCatalogClient: {},
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {},
  coreClient: {
    getX402Agents: (...args: unknown[]) => getX402AgentsMock(...args),
  },
}));

import { getAllCoreX402Agents } from "../core-loaders";

describe("getAllCoreX402Agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("follows the next cursor even when a fail-closed page is empty", async () => {
    const listedAgent = {
      id: "agent_x402_2",
      name: "Second-page agent",
      description: null,
      image: null,
      x402ResourcesUrl: null,
      pricingType: "fixed",
      isPayable: true,
      paymentSources: [
        {
          caip2Network: "eip155:8453",
          asset: "0x1111111111111111111111111111111111111111",
          decimals: 6,
          payTo: "0x2222222222222222222222222222222222222222",
          amount: "250000",
          credits: 0.5,
        },
      ],
    };

    getX402AgentsMock
      .mockResolvedValueOnce({
        data: [],
        meta: { pagination: { nextCursor: "candidate_2" } },
      })
      .mockResolvedValueOnce({
        data: [listedAgent],
        meta: { pagination: { nextCursor: null } },
      });

    await expect(getAllCoreX402Agents()).resolves.toEqual([listedAgent]);
    expect(getX402AgentsMock).toHaveBeenNthCalledWith(1, {
      cursor: undefined,
      limit: 100,
    });
    expect(getX402AgentsMock).toHaveBeenNthCalledWith(2, {
      cursor: "candidate_2",
      limit: 100,
    });
  });
});
