import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getAllCoreAgentsMock = vi.fn();
const getCoreAgentByIdMock = vi.fn();
const mapCoreAgentsToAgentWithCreditsPriceMock = vi.fn();
const mapCoreAgentToAgentWithCreditsPriceMock = vi.fn();
const mapCoreMyAgentReviewMock = vi.fn();

const getFavoriteAgentsMock = vi.fn();
const getHiredAgentsMock = vi.fn();
const getAgentRatingEligibilityMock = vi.fn();
const getMyAgentReviewMock = vi.fn();

class CoreApiRequestErrorMock extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "CoreApiRequestError";
    this.status = options?.status;
  }
}

vi.mock("@/lib/agents/core-loaders", () => ({
  getAllCoreAgents: (...args: unknown[]) => getAllCoreAgentsMock(...args),
  getCoreAgentById: (...args: unknown[]) => getCoreAgentByIdMock(...args),
}));

vi.mock("@/lib/agents/core-dto-mappers", () => ({
  mapCoreAgentsToAgentWithCreditsPrice: (...args: unknown[]) =>
    mapCoreAgentsToAgentWithCreditsPriceMock(...args),
  mapCoreAgentToAgentWithCreditsPrice: (...args: unknown[]) =>
    mapCoreAgentToAgentWithCreditsPriceMock(...args),
  mapCoreMyAgentReview: (...args: unknown[]) =>
    mapCoreMyAgentReviewMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: CoreApiRequestErrorMock,
  coreClient: {
    getFavoriteAgents: (...args: unknown[]) => getFavoriteAgentsMock(...args),
    getHiredAgents: (...args: unknown[]) => getHiredAgentsMock(...args),
    getAgentRatingEligibility: (...args: unknown[]) =>
      getAgentRatingEligibilityMock(...args),
    getMyAgentReview: (...args: unknown[]) => getMyAgentReviewMock(...args),
  },
}));

describe("agent.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("serves favorite agents from core", async () => {
    const coreAgents = [{ id: "fav-1" }];
    getFavoriteAgentsMock.mockResolvedValue({ data: coreAgents });

    const { agentService } = await import("../agent.service");
    const result = await agentService.getFavoriteAgents();

    expect(getFavoriteAgentsMock).toHaveBeenCalledTimes(1);
    expect(mapCoreAgentsToAgentWithCreditsPriceMock).toHaveBeenCalledWith(
      coreAgents,
    );
    expect(result.map((agent) => agent.id)).toEqual(["fav-1"]);
  });

  it("degrades to an empty favorites list when core fails", async () => {
    getFavoriteAgentsMock.mockRejectedValue(new Error("boom"));

    const { agentService } = await import("../agent.service");
    const result = await agentService.getFavoriteAgents();

    expect(result).toEqual([]);
    expect(mapCoreAgentsToAgentWithCreditsPriceMock).not.toHaveBeenCalled();
  });

  it("serves hired agents from core", async () => {
    const coreAgents = [{ id: "hired-1" }];
    getHiredAgentsMock.mockResolvedValue({ data: coreAgents });

    const { agentService } = await import("../agent.service");
    const result = await agentService.getHiredAgents();

    expect(getHiredAgentsMock).toHaveBeenCalledTimes(1);
    expect(mapCoreAgentsToAgentWithCreditsPriceMock).toHaveBeenCalledWith(
      coreAgents,
    );
    expect(result.map((agent) => agent.id)).toEqual(["hired-1"]);
  });

  it("reports rating eligibility from core", async () => {
    getAgentRatingEligibilityMock.mockResolvedValue({
      data: { eligible: true },
    });

    const { agentService } = await import("../agent.service");
    const result = await agentService.canUserRateAgent("agent-1");

    expect(getAgentRatingEligibilityMock).toHaveBeenCalledWith("agent-1");
    expect(result).toBe(true);
  });

  it("treats an unavailable agent (core 404) as not rateable", async () => {
    getAgentRatingEligibilityMock.mockRejectedValue(
      new CoreApiRequestErrorMock("not found", { status: 404 }),
    );

    const { agentService } = await import("../agent.service");
    const result = await agentService.canUserRateAgent("agent-1");

    expect(result).toBe(false);
  });

  it("serves the caller's own rating from core", async () => {
    getMyAgentReviewMock.mockResolvedValue({
      data: { rating: 4, comment: "Solid." },
    });
    mapCoreMyAgentReviewMock.mockReturnValue({ rating: 4, comment: "Solid." });

    const { agentService } = await import("../agent.service");
    const result = await agentService.getUserRatingForAgent("agent-1");

    expect(getMyAgentReviewMock).toHaveBeenCalledWith("agent-1");
    expect(result).toEqual({ rating: 4, comment: "Solid." });
  });

  it("returns null when core reports the agent is unavailable (404)", async () => {
    getMyAgentReviewMock.mockRejectedValue(
      new CoreApiRequestErrorMock("not found", { status: 404 }),
    );

    const { agentService } = await import("../agent.service");
    const result = await agentService.getUserRatingForAgent("agent-1");

    expect(result).toBeNull();
    expect(mapCoreMyAgentReviewMock).not.toHaveBeenCalled();
  });
});
