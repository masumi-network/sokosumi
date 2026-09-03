import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthenticationContext } from "@/middleware/auth";

const {
  authContextState,
  agentCountMock,
  agentFindManyMock,
  buildAvailableAgentWhereClauseMock,
  calculateAgentRatingsMock,
  calculateAverageExecutionTimesMock,
  getAgentCostMock,
  getAgentAuthorImageMock,
  getAgentDescriptionMock,
  getAgentIconMock,
  getAgentImageMock,
  getAgentNameMock,
  creditCostFindManyMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
  syncMetadataFindUniqueMock,
} = vi.hoisted(() => ({
  authContextState: {
    // Typed as the real union, not a hand-written shape: the previous local
    // literal declared an `agentId` field that exists nowhere in
    // middleware/auth.ts, so drift from the real context could not be a
    // compile error. Harmless while isAgentAuthContext reads only `actor`
    // and `context`, but a later gate reading `coworkerId` would silently see
    // undefined and the test would still pass.
    current: null as AuthenticationContext | null,
  },
  agentCountMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  buildAvailableAgentWhereClauseMock: vi.fn(),
  calculateAgentRatingsMock: vi.fn(),
  calculateAverageExecutionTimesMock: vi.fn(),
  getAgentCostMock: vi.fn(),
  getAgentAuthorImageMock: vi.fn(),
  getAgentDescriptionMock: vi.fn(),
  getAgentIconMock: vi.fn(),
  getAgentImageMock: vi.fn(),
  getAgentNameMock: vi.fn(),
  creditCostFindManyMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  syncMetadataFindUniqueMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      if (!authContextState.current) {
        return c.json({ error: "Unauthorized", message: "Unauthorized" }, 401);
      }
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/helpers/agent", () => ({
  AGENT_PRICING_READ_TRANSACTION_OPTIONS: { isolationLevel: "RepeatableRead" },
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  calculateAverageExecutionTimes: calculateAverageExecutionTimesMock,
  getAgentAuthorImage: getAgentAuthorImageMock,
  getAgentDescription: getAgentDescriptionMock,
  getAgentIcon: getAgentIconMock,
  getAgentImage: getAgentImageMock,
  getAgentName: getAgentNameMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
  getCardanoV2ReadySources: () => Promise.resolve([]),
}));

vi.mock("@/helpers/agent-rating", () => ({
  calculateAgentRatings: calculateAgentRatingsMock,
}));

vi.mock("@/helpers/agent-cost", () => ({
  getAgentCost: getAgentCostMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: {
      findMany: agentFindManyMock,
      count: agentCountMock,
    },
    creditCost: {
      findMany: creditCostFindManyMock,
    },
    // The x402 mount-order pin below routes GET /x402 through the REAL
    // composed router; the listing's readiness read must resolve.
    syncMetadata: {
      findUnique: syncMetadataFindUniqueMock,
    },
    $transaction: prismaTransactionMock,
  },
}));

const { default: agentsRouter } = await import("./index");

describe("agents routes auth gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = null;

    // Batch form: the list route reads its page in one snapshot.
    prismaTransactionMock.mockImplementation(async (operations: unknown) =>
      Array.isArray(operations) ? await Promise.all(operations) : operations,
    );

    buildAvailableAgentWhereClauseMock.mockReturnValue({ isAvailable: true });
    getCreditCostsOrThrowMock.mockResolvedValue([]);
    creditCostFindManyMock.mockResolvedValue([]);
    getAgentCostMock.mockReturnValue({ cents: BigInt(0) });
    getAgentAuthorImageMock.mockReturnValue(null);
    getAgentNameMock.mockImplementation((agent) => agent.name);
    getAgentDescriptionMock.mockImplementation((agent) => agent.description);
    getAgentImageMock.mockImplementation((agent) => agent.image);
    getAgentIconMock.mockImplementation((agent) => agent.icon);
    calculateAverageExecutionTimesMock.mockResolvedValue(new Map());
    calculateAgentRatingsMock.mockResolvedValue(new Map());
    agentFindManyMock.mockResolvedValue([]);
    agentCountMock.mockResolvedValue(0);
  });

  it("allows anonymous GET /agents list", async () => {
    const response = await agentsRouter.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalled();
  });

  it("returns 422 for invalid category on composed public list route", async () => {
    const response = await agentsRouter.request(
      "http://localhost/?category=research,",
    );

    expect(response.status).toBe(422);
    expect(agentFindManyMock).not.toHaveBeenCalled();
    expect(agentCountMock).not.toHaveBeenCalled();
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("rejects anonymous GET /agents/{id}", async () => {
    const response = await agentsRouter.request("http://localhost/agent_123");

    expect(response.status).toBe(401);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("treats GET /x402 as an agent id, not a listing", async () => {
    const response = await agentsRouter.request("http://localhost/x402");

    expect(response.status).toBe(401);
    expect(agentFindManyMock).not.toHaveBeenCalled();
  });

  it("lists x402 agents on the public GET /?kind=x402", async () => {
    syncMetadataFindUniqueMock.mockResolvedValue(null);

    const response = await agentsRouter.request("http://localhost/?kind=x402");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: [] });
    expect(prismaTransactionMock).toHaveBeenCalled();
    expect(agentFindManyMock).toHaveBeenCalled();
  });
});
