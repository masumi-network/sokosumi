import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const upsertWorkspaceForContextMock = vi.fn();
const getSessionMock = vi.fn();
const getHiredAgentsWithLatestJobByUserIdAndWorkspaceMock = vi.fn();

const getAllCoreAgentsMock = vi.fn();
const getCoreAgentByIdMock = vi.fn();
const mapCoreAgentsToAgentWithCreditsPriceMock = vi.fn();
const mapCoreAgentToAgentWithCreditsPriceMock = vi.fn();

vi.mock("@/lib/agents/core-loaders", () => ({
  getAllCoreAgents: (...args: unknown[]) => getAllCoreAgentsMock(...args),
  getCoreAgentById: (...args: unknown[]) => getCoreAgentByIdMock(...args),
}));

vi.mock("@/lib/agents/core-dto-mappers", () => ({
  mapCoreAgentsToAgentWithCreditsPrice: (...args: unknown[]) =>
    mapCoreAgentsToAgentWithCreditsPriceMock(...args),
  mapCoreAgentToAgentWithCreditsPrice: (...args: unknown[]) =>
    mapCoreAgentToAgentWithCreditsPriceMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  agentListRepository: {
    upsertAgentListForUserId: vi.fn(),
  },
  agentRatingRepository: {
    getAgentRatingStats: vi.fn(),
    getRatingsByAgentId: vi.fn(),
    getUserRatingForAgent: vi.fn(),
    upsertRating: vi.fn(),
  },
  agentRepository: {
    getHiredAgentsWithLatestJobByUserIdAndWorkspace: (...args: unknown[]) =>
      getHiredAgentsWithLatestJobByUserIdAndWorkspaceMock(...args),
  },
  creditCostRepository: {
    getCreditCosts: vi.fn(),
  },
  jobRepository: {
    doesUserHaveFinishedJobWithAgent: vi.fn(),
  },
  workspaceRepository: {
    upsertWorkspaceForContext: (...args: unknown[]) =>
      upsertWorkspaceForContextMock(...args),
  },
}));

vi.mock("@/lib/auth/utils", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: vi.fn(),
  },
}));

describe("agent.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsertWorkspaceForContextMock.mockResolvedValue({
      id: "11111111-1111-7111-8111-111111111111",
    });
    // Default mapper behavior: tag mapped agents so wiring is observable.
    mapCoreAgentsToAgentWithCreditsPriceMock.mockImplementation(
      (agents: Array<{ id: string }>) =>
        agents.map((agent) => ({ id: agent.id, mapped: true })),
    );
    mapCoreAgentToAgentWithCreditsPriceMock.mockImplementation(
      (agent: { id: string }) => ({ id: agent.id, mapped: true }),
    );
  });

  it("serves priced available agents from core (credits already computed)", async () => {
    const coreAgents = [{ id: "agent-1" }];
    getAllCoreAgentsMock.mockResolvedValue(coreAgents);

    const { agentService } = await import("../agent.service");
    const result = await agentService.getAvailableAgentsWithCreditsPrice();

    expect(getAllCoreAgentsMock).toHaveBeenCalledTimes(1);
    expect(mapCoreAgentsToAgentWithCreditsPriceMock).toHaveBeenCalledWith(
      coreAgents,
    );
    expect(result.map((agent) => agent.id)).toEqual(["agent-1"]);
  });

  it("returns null for an unavailable agent by id (core 404)", async () => {
    getCoreAgentByIdMock.mockResolvedValue(null);

    const { agentService } = await import("../agent.service");
    const result = await agentService.getAvailableAgentById("missing");

    expect(getCoreAgentByIdMock).toHaveBeenCalledWith("missing");
    expect(mapCoreAgentToAgentWithCreditsPriceMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("maps an available agent fetched by id from core", async () => {
    getCoreAgentByIdMock.mockResolvedValue({ id: "agent-1" });

    const { agentService } = await import("../agent.service");
    const result = await agentService.getAvailableAgentById("agent-1");

    expect(result).toEqual({ id: "agent-1", mapped: true });
  });

  it("reads the random agent's average execution time from core metrics", async () => {
    getAllCoreAgentsMock.mockResolvedValue([
      {
        id: "agent-1",
        metrics: { executions: { averageTime: 42 } },
      },
    ]);

    const { agentService } = await import("../agent.service");
    const result = await agentService.getRandomAvailableAgentData();

    expect(result).toEqual({
      agent: { id: "agent-1", mapped: true },
      averageExecutionDuration: 42,
    });
  });

  it("returns null random agent data when core has no agents", async () => {
    getAllCoreAgentsMock.mockResolvedValue([]);

    const { agentService } = await import("../agent.service");
    const result = await agentService.getRandomAvailableAgentData();

    expect(result).toBeNull();
  });

  it("resolves the active workspace before loading hired agents", async () => {
    getSessionMock.mockResolvedValue({
      user: {
        id: "user_123",
      },
      session: {
        activeOrganizationId: "org_123",
      },
    });
    getHiredAgentsWithLatestJobByUserIdAndWorkspaceMock.mockResolvedValue([]);

    const { agentService } = await import("../agent.service");

    await agentService.getHiredAgents();

    expect(upsertWorkspaceForContextMock).toHaveBeenCalledWith(
      "user_123",
      "org_123",
      expect.any(Object),
    );
    expect(
      getHiredAgentsWithLatestJobByUserIdAndWorkspaceMock,
    ).toHaveBeenCalledWith(
      "user_123",
      "11111111-1111-7111-8111-111111111111",
      expect.any(Object),
    );
  });
});
