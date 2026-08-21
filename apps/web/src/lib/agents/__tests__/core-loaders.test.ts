import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

const getAgentsMock = vi.fn();
const getAgentByIdMock = vi.fn();

vi.mock("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

vi.mock("@/lib/clients/core.catalog.client", () => ({
  coreCatalogClient: {
    getAgents: (...args: unknown[]) => getAgentsMock(...args),
  },
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;
  },
  coreClient: {
    getAgentById: (...args: unknown[]) => getAgentByIdMock(...args),
  },
}));

describe("getAllCoreAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("requests only the cardano rail so the gallery never ingests x402 items", async () => {
    getAgentsMock.mockResolvedValue({
      data: [{ id: "agent-cardano", kind: "cardano" }],
      meta: { pagination: { nextCursor: null } },
    });

    const { getAllCoreAgents } = await import("../core-loaders");
    const agents = await getAllCoreAgents();

    expect(getAgentsMock).toHaveBeenCalledWith({
      cursor: undefined,
      kind: ["cardano"],
      limit: 100,
    });
    expect(agents).toEqual([{ id: "agent-cardano", kind: "cardano" }]);
  });

  it("drops x402 payloads if a mixed page still arrives", async () => {
    getAgentsMock.mockResolvedValue({
      data: [
        { id: "agent-cardano", kind: "cardano" },
        { id: "agent-x402", kind: "x402" },
      ],
      meta: { pagination: { nextCursor: null } },
    });

    const { getAllCoreAgents } = await import("../core-loaders");
    const agents = await getAllCoreAgents();

    expect(agents).toEqual([{ id: "agent-cardano", kind: "cardano" }]);
  });
});
