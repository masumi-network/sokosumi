import { describe, expect, it } from "vitest";

import {
  buildJevLabelRequest,
  buildJevRelatedPairRequest,
  buildJevSearchPairRequest,
  conservativeTokenCount,
  isJevRequestRejection,
  LABEL_EVALUATION_CEILINGS,
  RELATED_PAIR_CEILINGS,
  SEARCH_PAIR_CEILINGS,
  truncateToTokenBudget,
} from "./jev-request";

describe("conservativeTokenCount", () => {
  it("counts code points, so an emoji is one and not two", () => {
    expect(conservativeTokenCount("👩🏽‍🚀")).toBe(4);
    expect(conservativeTokenCount("abc")).toBe(3);
  });
});

describe("truncateToTokenBudget", () => {
  it("leaves text that already fits alone", () => {
    expect(truncateToTokenBudget("short", 100)).toBe("short");
  });

  it("never splits a grapheme cluster", () => {
    const text = "é".repeat(10);
    const cut = truncateToTokenBudget(text, 5);
    expect(cut.normalize("NFD")).toBe(cut);
    expect(cut.endsWith("́")).toBe(true);
  });

  it("is deterministic for the same input and budget", () => {
    const text = "aurora research findings ".repeat(40);
    expect(truncateToTokenBudget(text, 90)).toBe(
      truncateToTokenBudget(text, 90),
    );
  });

  it("returns nothing for a zero budget", () => {
    expect(truncateToTokenBudget("anything", 0)).toBe("");
  });
});

describe("buildJevSearchPairRequest", () => {
  it("stays inside the 1,024-token ceiling for the whole serialized body", () => {
    const result = buildJevSearchPairRequest({
      query: "what did we learn about bicycle commuters",
      candidateId: "11111111-1111-4111-8111-111111111111",
      candidateTitle: "Aurora audience research",
      candidateExcerpt: "commuter findings ".repeat(400),
    });

    expect(isJevRequestRejection(result)).toBe(false);
    if (isJevRequestRejection(result)) return;
    expect(result.tokens).toBeLessThanOrEqual(SEARCH_PAIR_CEILINGS.total);
  });

  it("keeps the JSON valid after trimming the excerpt", () => {
    const result = buildJevSearchPairRequest({
      query: "q".repeat(4_000),
      candidateId: "id",
      candidateTitle: "t".repeat(4_000),
      candidateExcerpt: "e".repeat(40_000),
    });
    expect(isJevRequestRejection(result)).toBe(false);
    if (isJevRequestRejection(result)) return;
    expect(() => JSON.parse(result.serialized)).not.toThrow();
    expect(result.tokens).toBeLessThanOrEqual(SEARCH_PAIR_CEILINGS.total);
  });

  it("truncates the query to its own component ceiling", () => {
    const result = buildJevSearchPairRequest({
      query: "q".repeat(4_000),
      candidateId: "id",
      candidateTitle: "title",
      candidateExcerpt: "excerpt",
    });
    if (isJevRequestRejection(result)) throw new Error("unexpected rejection");
    const body = result.body as { query: string };
    expect(conservativeTokenCount(body.query)).toBeLessThanOrEqual(
      SEARCH_PAIR_CEILINGS.components.query,
    );
  });

  it("rejects rather than sending when fixed overhead alone will not fit", () => {
    const result = buildJevSearchPairRequest({
      query: "short",
      candidateId: "x".repeat(5_000),
      candidateTitle: "t",
      candidateExcerpt: "e",
    });
    expect(isJevRequestRejection(result)).toBe(true);
  });

  it("digests the exact bytes it would send", () => {
    const first = buildJevSearchPairRequest({
      query: "aurora",
      candidateId: "a",
      candidateTitle: "t",
      candidateExcerpt: "e",
    });
    const second = buildJevSearchPairRequest({
      query: "aurora",
      candidateId: "a",
      candidateTitle: "t",
      candidateExcerpt: "different",
    });
    if (isJevRequestRejection(first) || isJevRequestRejection(second)) {
      throw new Error("unexpected rejection");
    }
    expect(first.digest).not.toBe(second.digest);
  });
});

describe("buildJevRelatedPairRequest", () => {
  it("prices three repeated seed passages inside the 2,048 ceiling", () => {
    const result = buildJevRelatedPairRequest({
      seedPassages: [
        "seed one ".repeat(500),
        "seed two ".repeat(500),
        "seed three ".repeat(500),
      ],
      candidateId: "cand",
      candidateTitle: "Candidate",
      candidateExcerpt: "candidate body ".repeat(500),
    });
    expect(isJevRequestRejection(result)).toBe(false);
    if (isJevRequestRejection(result)) return;
    expect(result.tokens).toBeLessThanOrEqual(RELATED_PAIR_CEILINGS.total);
  });

  it("uses at most three seeds", () => {
    const result = buildJevRelatedPairRequest({
      seedPassages: ["a", "b", "c", "d", "e"],
      candidateId: "cand",
      candidateTitle: "Candidate",
      candidateExcerpt: "body",
    });
    if (isJevRequestRejection(result)) throw new Error("unexpected rejection");
    const body = result.body as { seeds: string[] };
    expect(body.seeds).toHaveLength(3);
  });
});

describe("buildJevLabelRequest", () => {
  it("stays inside the 4,096 ceiling with a large vocabulary", () => {
    const vocabulary = Array.from({ length: 40 }, (_, index) => ({
      id: `label-${index}`,
      name: `Label ${index}`,
      description: "a rubric description ".repeat(20),
    }));
    const result = buildJevLabelRequest({
      documentExcerpt: "document body ".repeat(2_000),
      vocabulary,
      projects: [
        { id: "p1", name: "Aurora launch", description: "the launch project" },
      ],
    });
    expect(isJevRequestRejection(result)).toBe(false);
    if (isJevRequestRejection(result)) return;
    expect(result.tokens).toBeLessThanOrEqual(LABEL_EVALUATION_CEILINGS.total);
    expect(() => JSON.parse(result.serialized)).not.toThrow();
  });

  it("carries ids so a reply can be validated against what was asked", () => {
    const result = buildJevLabelRequest({
      documentExcerpt: "body",
      vocabulary: [{ id: "label-7", name: "Research", description: null }],
      projects: [],
    });
    if (isJevRequestRejection(result)) throw new Error("unexpected rejection");
    expect(result.serialized).toContain("label-7");
  });
});
