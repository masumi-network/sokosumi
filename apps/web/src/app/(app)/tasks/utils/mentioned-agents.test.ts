import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCoreAgentByIdMock = vi.fn();

vi.mock("@/lib/agents/core-loaders", () => ({
  getCoreAgentById: (...args: unknown[]) => getCoreAgentByIdMock(...args),
}));

import {
  collectMentionedAgentIds,
  resolveMentionedAgentsById,
} from "./mentioned-agents";

describe("collectMentionedAgentIds", () => {
  it("deduplicates mention ids across descriptions", () => {
    expect(
      collectMentionedAgentIds([
        "Ping @agent-1 and @agent-2",
        "Again @agent-1",
        null,
      ]),
    ).toEqual(["agent-1", "agent-2"]);
  });
});

describe("resolveMentionedAgentsById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads only agents referenced in descriptions", async () => {
    getCoreAgentByIdMock.mockImplementation(async (agentId: string) => ({
      id: agentId,
      name: `Agent ${agentId}`,
    }));

    const agentsById = await resolveMentionedAgentsById([
      "Use @agent-a for research",
    ]);

    expect(getCoreAgentByIdMock).toHaveBeenCalledTimes(1);
    expect(getCoreAgentByIdMock).toHaveBeenCalledWith("agent-a");
    expect(agentsById.get("agent-a")).toMatchObject({ id: "agent-a" });
  });

  it("skips agents that are not found", async () => {
    getCoreAgentByIdMock.mockResolvedValue(null);

    const agentsById = await resolveMentionedAgentsById(["@missing-agent"]);

    expect(agentsById.size).toBe(0);
  });
});
