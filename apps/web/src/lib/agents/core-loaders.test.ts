import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

const getAgentsMock = vi.fn();
const getCategoriesMock = vi.fn();
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
    getCategories: (...args: unknown[]) => getCategoriesMock(...args),
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

  it("requests Cardano and x402 so the catalog covers both rails (SOK-922)", async () => {
    getAgentsMock.mockResolvedValue({
      data: [
        { id: "agent-cardano", kind: "cardano" },
        { id: "agent-x402", kind: "x402" },
      ],
      meta: { pagination: { nextCursor: null } },
    });

    const { getAllCoreAgents } = await import("./core-loaders");
    const agents = await getAllCoreAgents();

    expect(getAgentsMock).toHaveBeenCalledWith({
      cursor: undefined,
      kind: ["cardano", "x402"],
      limit: 100,
    });
    expect(agents).toEqual([
      { id: "agent-cardano", kind: "cardano" },
      { id: "agent-x402", kind: "x402" },
    ]);
  });

  it("keeps both kinds when a mixed page arrives", async () => {
    getAgentsMock.mockResolvedValue({
      data: [
        { id: "agent-cardano", kind: "cardano" },
        { id: "agent-x402", kind: "x402" },
      ],
      meta: { pagination: { nextCursor: null } },
    });

    const { getAllCoreAgents } = await import("./core-loaders");
    const agents = await getAllCoreAgents();

    expect(agents.map((agent) => agent.kind)).toEqual(["cardano", "x402"]);
  });
});

describe("getCoreCategories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("loads categories via the cookie-free catalog client (SOK-922)", async () => {
    getCategoriesMock.mockResolvedValue({
      data: [{ slug: "writing", name: "Writing", priority: 1 }],
    });

    const { getCoreCategories } = await import("./core-loaders");
    const categories = await getCoreCategories();

    expect(getCategoriesMock).toHaveBeenCalledWith();
    expect(categories).toEqual([
      { slug: "writing", name: "Writing", priority: 1 },
    ]);
  });
});
