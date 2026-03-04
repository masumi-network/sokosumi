export {};

jest.mock("server-only", () => ({}));

import {
  AgentStatus,
  AgentWithRelations,
  PricingType,
} from "@sokosumi/database";

const getShownAgentsWithRelationsByStatusMock = jest.fn();
const getCreditCostsMock = jest.fn();
const getCreditCostByUnitMock = jest.fn();
const transactionMock = jest.fn();
const getAuthContextMock = jest.fn();

jest.mock("@sokosumi/database/repositories", () => ({
  agentListRepository: {
    upsertAgentListForUserId: jest.fn(),
  },
  agentRatingRepository: {
    getAgentRatingStats: jest.fn(),
    getRatingsByAgentId: jest.fn(),
    getUserRatingForAgent: jest.fn(),
    upsertRating: jest.fn(),
  },
  agentRepository: {
    getHiredAgentsWithLatestJobByUserIdAndOrganization: jest.fn(),
    getShownAgentWithRelationById: jest.fn(),
    getShownAgentsWithRelationsByStatus: (...args: unknown[]) =>
      getShownAgentsWithRelationsByStatusMock(...args),
  },
  creditCostRepository: {
    getCreditCostByUnit: (...args: unknown[]) =>
      getCreditCostByUnitMock(...args),
    getCreditCosts: (...args: unknown[]) => getCreditCostsMock(...args),
  },
  jobRepository: {
    doesUserHaveFinishedJobWithAgent: jest.fn(),
    getAverageExecutionDurationByAgentId: jest.fn(),
  },
}));

jest.mock("@/lib/auth/utils", () => ({
  getAuthContext: (...args: unknown[]) => getAuthContextMock(...args),
}));

jest.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

function buildFixedAgent({
  id,
  amounts,
  isShown = true,
}: {
  id: string;
  amounts: Array<{ unit: string; amount: bigint }>;
  isShown?: boolean;
}): AgentWithRelations {
  return {
    id,
    isShown,
    pricing: {
      pricingType: PricingType.FIXED,
      fixedPricing: {
        amounts,
      },
    },
  } as unknown as AgentWithRelations;
}

function buildFreeAgent(id: string): AgentWithRelations {
  return {
    id,
    isShown: true,
    pricing: {
      pricingType: PricingType.FREE,
      fixedPricing: null,
    },
  } as unknown as AgentWithRelations;
}

function buildUnknownAgent(id: string): AgentWithRelations {
  return {
    id,
    isShown: true,
    pricing: {
      pricingType: PricingType.UNKNOWN,
      fixedPricing: null,
    },
  } as unknown as AgentWithRelations;
}

describe("agent.service", () => {
  const txMock = { tx: "mock" };

  beforeEach(() => {
    jest.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        await callback(txMock),
    );
  });

  it("keeps availability filtering consistent between list and priced methods", async () => {
    getShownAgentsWithRelationsByStatusMock.mockResolvedValue([
      buildFixedAgent({
        id: "agent-valid",
        amounts: [{ unit: "token", amount: BigInt(2) }],
      }),
      buildFixedAgent({
        id: "agent-hidden",
        amounts: [{ unit: "token", amount: BigInt(1) }],
        isShown: false,
      }),
      buildUnknownAgent("agent-unknown"),
      buildFreeAgent("agent-free"),
    ]);
    getCreditCostsMock.mockResolvedValue([
      { unit: "token", centsPerUnit: 10n },
    ]);

    const { agentService } = await import("../agent.service");
    const availableAgents = await agentService.getAvailableAgents();
    const agentsWithCreditsPrice =
      await agentService.getAvailableAgentsWithCreditsPrice();

    const availableAgentIds = availableAgents.map((agent) => agent.id).sort();
    const pricedAgentIds = agentsWithCreditsPrice
      .map((agent) => agent.id)
      .sort();

    expect(availableAgentIds).toEqual(["agent-free", "agent-valid"]);
    expect(pricedAgentIds).toEqual(availableAgentIds);
  });

  it("gets credit costs once and computes prices for all available agents", async () => {
    getShownAgentsWithRelationsByStatusMock.mockResolvedValue([
      buildFixedAgent({
        id: "agent-1",
        amounts: [
          { unit: "token", amount: BigInt(2) },
          { unit: "second", amount: BigInt(3) },
        ],
      }),
      buildFreeAgent("agent-2"),
    ]);
    getCreditCostsMock.mockResolvedValue([
      { unit: "token", centsPerUnit: BigInt(10) },
      { unit: "second", centsPerUnit: BigInt(5) },
    ]);

    const { agentService } = await import("../agent.service");
    const result = await agentService.getAvailableAgentsWithCreditsPrice();

    expect(getShownAgentsWithRelationsByStatusMock).toHaveBeenCalledWith(
      AgentStatus.ONLINE,
      txMock,
    );
    expect(getCreditCostsMock).toHaveBeenCalledTimes(1);
    expect(getCreditCostsMock).toHaveBeenCalledWith(txMock);
    expect(getCreditCostByUnitMock).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "agent-1",
          creditsPrice: { cents: BigInt(35) },
        }),
        expect.objectContaining({
          id: "agent-2",
          creditsPrice: { cents: BigInt(0) },
        }),
      ]),
    );
  });

  it("skips agents when pricing cannot be computed and continues with others", async () => {
    getShownAgentsWithRelationsByStatusMock.mockResolvedValue([
      buildFixedAgent({
        id: "agent-valid",
        amounts: [{ unit: "token", amount: BigInt(2) }],
      }),
      buildFixedAgent({
        id: "agent-invalid",
        amounts: [],
      }),
    ]);
    getCreditCostsMock.mockResolvedValue([
      { unit: "token", centsPerUnit: 10n },
    ]);

    const { agentService } = await import("../agent.service");
    const result = await agentService.getAvailableAgentsWithCreditsPrice();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        id: "agent-valid",
        creditsPrice: { cents: 20n },
      }),
    );
  });

  it("computes single-agent price from batched credit costs", async () => {
    const agent = buildFixedAgent({
      id: "agent-1",
      amounts: [
        { unit: "token", amount: 2n },
        { unit: "second", amount: 3n },
      ],
    });
    const tx = { tx: "single" };
    getCreditCostsMock.mockResolvedValue([
      { unit: "token", centsPerUnit: 10n },
      { unit: "second", centsPerUnit: 5n },
    ]);

    const { agentService } = await import("../agent.service");
    const result = await agentService.getAgentCreditsPrice(
      agent,
      tx as unknown as never,
    );

    expect(getCreditCostsMock).toHaveBeenCalledWith(tx);
    expect(getCreditCostByUnitMock).not.toHaveBeenCalled();
    expect(result.creditsPrice.cents).toBe(35n);
  });
});
