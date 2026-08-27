import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

const getAgentsMock = vi.fn();
const getCategoriesMock = vi.fn();
const createClientMock = vi.fn();
const headersMock = vi.fn();
const mockClient = {
  id: "catalog-client",
} as never;

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreApiBaseUrl: () => "http://localhost:8787/v1",
  getCoreApiBaseUrl: () => "http://localhost:8787/v1",
}));

vi.mock("@/lib/clients/generated/core/client", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/clients/generated/core", () => ({
  getAgents: getAgentsMock,
  getCategories: getCategoriesMock,
}));

describe("core.catalog.client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    createClientMock.mockReturnValue(mockClient);
  });

  it("creates a cookie-free client and never reads request headers", async () => {
    getAgentsMock.mockResolvedValue({
      data: {
        data: [],
        meta: {
          requestId: "req_catalog",
          timestamp: new Date("2026-08-04T12:00:00.000Z"),
          pagination: {
            cursor: null,
            limit: 100,
            total: 0,
            nextCursor: null,
          },
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreCatalogClient } = await import("./core.catalog.client");
    await coreCatalogClient.getAgents({ limit: 100 });

    expect(headersMock).not.toHaveBeenCalled();
    expect(createClientMock).toHaveBeenCalledWith({
      baseUrl: "http://localhost:8787/v1",
      headers: {},
    });
    expect(getAgentsMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      query: { limit: 100 },
    });
  });

  it("fetches categories without session cookies", async () => {
    getCategoriesMock.mockResolvedValue({
      data: {
        data: [],
        meta: {
          requestId: "req_categories",
          timestamp: new Date("2026-08-04T12:00:00.000Z"),
        },
      },
      response: new Response("{}", { status: 200 }),
    });

    const { coreCatalogClient } = await import("./core.catalog.client");
    const response = await coreCatalogClient.getCategories();

    expect(headersMock).not.toHaveBeenCalled();
    expect(getCategoriesMock).toHaveBeenCalledWith({
      cache: "no-store",
      client: mockClient,
      query: undefined,
    });
    expect(response.data).toEqual([]);
  });
});
