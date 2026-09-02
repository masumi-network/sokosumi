import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getAllCoreAgentsMock = vi.fn();
const getCoreAgentByIdMock = vi.fn();
const mapCoreMyAgentReviewMock = vi.fn();

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
  mapCoreMyAgentReview: (...args: unknown[]) =>
    mapCoreMyAgentReviewMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: CoreApiRequestErrorMock,
  coreClient: {
    getAgentRatingEligibility: (...args: unknown[]) =>
      getAgentRatingEligibilityMock(...args),
    getMyAgentReview: (...args: unknown[]) => getMyAgentReviewMock(...args),
  },
}));

describe("agent.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves Cardano agents from the mixed catalog for mention pricing", async () => {
    const cardanoAgent = { id: "agent-1", kind: "cardano" as const };
    const x402Agent = { id: "agent-x402", kind: "x402" as const };
    getAllCoreAgentsMock.mockResolvedValue([cardanoAgent, x402Agent]);

    const { agentService } = await import("./agent.service");
    const result = await agentService.getAvailableAgentsWithCreditsPrice();

    expect(getAllCoreAgentsMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual([cardanoAgent]);
  });

  it("returns no mention agents when the catalog fetch fails", async () => {
    getAllCoreAgentsMock.mockRejectedValue(new Error("fetch failed"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { agentService } = await import("./agent.service");
    await expect(
      agentService.getAvailableAgentsWithCreditsPrice(),
    ).resolves.toEqual([]);

    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("returns null for an unavailable agent by id (core 404)", async () => {
    getCoreAgentByIdMock.mockResolvedValue(null);

    const { agentService } = await import("./agent.service");
    const result = await agentService.getAvailableAgentById("missing");

    expect(getCoreAgentByIdMock).toHaveBeenCalledWith("missing");
    expect(result).toBeNull();
  });

  it("returns an available agent fetched by id from core", async () => {
    const coreAgent = { id: "agent-1" };
    getCoreAgentByIdMock.mockResolvedValue(coreAgent);

    const { agentService } = await import("./agent.service");
    const result = await agentService.getAvailableAgentById("agent-1");

    expect(result).toEqual(coreAgent);
  });

  it("reports rating eligibility from core", async () => {
    getAgentRatingEligibilityMock.mockResolvedValue({
      data: { eligible: true },
    });

    const { agentService } = await import("./agent.service");
    const result = await agentService.canUserRateAgent("agent-1");

    expect(getAgentRatingEligibilityMock).toHaveBeenCalledWith("agent-1");
    expect(result).toBe(true);
  });

  it("treats an unavailable agent (core 404) as not rateable", async () => {
    getAgentRatingEligibilityMock.mockRejectedValue(
      new CoreApiRequestErrorMock("not found", { status: 404 }),
    );

    const { agentService } = await import("./agent.service");
    const result = await agentService.canUserRateAgent("agent-1");

    expect(result).toBe(false);
  });

  it("serves the caller's own rating from core", async () => {
    getMyAgentReviewMock.mockResolvedValue({
      data: { rating: 4, comment: "Solid." },
    });
    mapCoreMyAgentReviewMock.mockReturnValue({ rating: 4, comment: "Solid." });

    const { agentService } = await import("./agent.service");
    const result = await agentService.getUserRatingForAgent("agent-1");

    expect(getMyAgentReviewMock).toHaveBeenCalledWith("agent-1");
    expect(result).toEqual({ rating: 4, comment: "Solid." });
  });

  it("returns null when core reports the agent is unavailable (404)", async () => {
    getMyAgentReviewMock.mockRejectedValue(
      new CoreApiRequestErrorMock("not found", { status: 404 }),
    );

    const { agentService } = await import("./agent.service");
    const result = await agentService.getUserRatingForAgent("agent-1");

    expect(result).toBeNull();
    expect(mapCoreMyAgentReviewMock).not.toHaveBeenCalled();
  });
});
