import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateMock } = vi.hoisted(() => ({ evaluateMock: vi.fn() }));
vi.mock("ai", () => ({
  experimental_evaluate: evaluateMock,
  gateway: { evaluationModel: vi.fn() },
}));

import {
  type AgentSearchCandidate,
  agentWordScore,
  MAX_RATED_AGENTS,
  queryWords,
  rateAgentFit,
} from "./agent-search";

function agent(
  id: string,
  fields: Partial<AgentSearchCandidate> = {},
): AgentSearchCandidate {
  return {
    id,
    name: `Agent ${id}`,
    summary: null,
    description: null,
    capabilityName: null,
    ...fields,
  };
}

describe("queryWords", () => {
  it("keeps the words that describe the work", () => {
    expect(queryWords("Find an agent that can write SEO blog posts")).toEqual([
      "seo",
      "blog",
      "post",
    ]);
  });

  it("keeps non-English words", () => {
    expect(queryWords("Wettbewerbsanalyse für KI-Agenten")).toEqual([
      "wettbewerbsanalyse",
      "für",
      "agenten",
    ]);
  });
});

describe("agentWordScore", () => {
  it("counts each word once, twice when it is in the name or capability", () => {
    const words = queryWords("SEO blog posts");
    expect(
      agentWordScore(
        words,
        agent("a", {
          name: "Blog Writer",
          summary: "Writes SEO friendly blog posts",
        }),
      ),
    ).toBe(4);
    expect(agentWordScore(words, agent("b", { summary: "Audits sites" }))).toBe(
      0,
    );
  });
});

describe("rateAgentFit", () => {
  beforeEach(() => vi.clearAllMocks());

  it("asks one question per candidate in a single call", async () => {
    evaluateMock.mockResolvedValue({
      answers: {
        agent0: { probability: 0.9 },
        agent1: { probability: 0.1 },
      },
    });
    const ratings = await rateAgentFit("blog post", [agent("a"), agent("b")]);
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(evaluateMock.mock.calls[0][0].questions)).toEqual([
      "agent0",
      "agent1",
    ]);
    expect(ratings).toEqual(
      new Map([
        ["a", 0.9],
        ["b", 0.1],
      ]),
    );
  });

  it("rates at most the capped number of candidates", async () => {
    evaluateMock.mockResolvedValue({ answers: {} });
    await rateAgentFit(
      "anything",
      Array.from({ length: MAX_RATED_AGENTS + 5 }, (_, index) =>
        agent(`${index}`),
      ),
    );
    expect(Object.keys(evaluateMock.mock.calls[0][0].questions)).toHaveLength(
      MAX_RATED_AGENTS,
    );
  });

  it("returns null when Jev fails, so the word ranking stands", async () => {
    evaluateMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(rateAgentFit("blog", [agent("a")])).resolves.toBeNull();
  });

  it("skips the call when there is nothing to rate", async () => {
    await expect(rateAgentFit("blog", [])).resolves.toEqual(new Map());
    expect(evaluateMock).not.toHaveBeenCalled();
  });
});
