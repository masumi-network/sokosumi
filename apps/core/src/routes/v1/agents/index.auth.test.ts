import { beforeEach, describe, expect, it, vi } from "vitest";

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
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  authContextState: {
    current: null as {
      actor: "user";
      userId: string;
      organizationId: string | null;
      role: string;
    } | null,
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
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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
});
