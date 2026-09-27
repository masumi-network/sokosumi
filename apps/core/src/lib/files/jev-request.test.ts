import { describe, expect, it } from "vitest";
import {
  buildJevLabelRequest,
  buildJevRelatedPairRequest,
  buildJevSearchPairRequest,
  conservativeTokenCount,
  isJevRequestRejection,
  LABEL_EVALUATION_CEILINGS,
  PROVIDER_FRAMING_TOKEN_ALLOWANCE,
  RELATED_PAIR_CEILINGS,
  SEARCH_PAIR_CEILINGS,
  truncateToTokenBudget,
} from "./jev-request";
import { RUBRICS, rubricEnvelopeTokens } from "./jev-rubrics";

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

describe("what the ceiling actually counts", () => {
  /**
   * The budget is supposed to be "tokens in the entire request". It stopped
   * being that when the rubric moved into the transport's question map: the
   * measurement kept counting only the state and added a flat 64 for
   * everything else, under-reporting a relevance call by about 686 tokens.
   */
  it("counts the transport envelope, not just the state", () => {
    const result = buildJevSearchPairRequest({
      query: "commuter research",
      candidateId: "resource-1",
      candidateTitle: "Commuters",
      candidateExcerpt: "Findings about bicycle commuters.",
    });
    expect(isJevRequestRejection(result)).toBe(false);
    if (isJevRequestRejection(result)) return;

    const stateOnly = conservativeTokenCount(result.serialized);
    const envelope = rubricEnvelopeTokens("relevance");

    // The reported figure is the state plus the envelope plus the small
    // remaining slack — not the state plus 64.
    expect(result.tokens).toBe(
      stateOnly + envelope + PROVIDER_FRAMING_TOKEN_ALLOWANCE,
    );
    expect(result.tokens).toBeGreaterThan(stateOnly + 600);
  });

  it("charges a label request its own, smaller envelope", () => {
    const result = buildJevLabelRequest({
      documentExcerpt: "Findings about bicycle commuters.",
      vocabulary: [{ id: "label-1", name: "Commuting", description: null }],
      projects: [],
    });
    expect(isJevRequestRejection(result)).toBe(false);
    if (isJevRequestRejection(result)) return;

    expect(result.tokens).toBe(
      conservativeTokenCount(result.serialized) +
        rubricEnvelopeTokens("belongs") +
        PROVIDER_FRAMING_TOKEN_ALLOWANCE,
    );
  });

  it("measures the envelope rather than hard-coding it", () => {
    // Two rungs versus three, so the figures must differ — and both must be
    // far above the flat allowance they replaced.
    const relevance = rubricEnvelopeTokens("relevance");
    const belongs = rubricEnvelopeTokens("belongs");

    expect(relevance).toBeGreaterThan(belongs);
    expect(belongs).toBeGreaterThan(PROVIDER_FRAMING_TOKEN_ALLOWANCE * 5);
  });

  it("still leaves the documented content budget intact", () => {
    // Raising the totals was to absorb the envelope, not to shrink what a
    // document may contribute.
    expect(SEARCH_PAIR_CEILINGS.components.candidate).toBe(640);
    expect(SEARCH_PAIR_CEILINGS.total).toBeGreaterThan(
      SEARCH_PAIR_CEILINGS.components.query +
        SEARCH_PAIR_CEILINGS.components.candidate +
        rubricEnvelopeTokens("relevance"),
    );
  });
});

describe("what the prompt tells the model", () => {
  /**
   * The state and the questions have to agree. They did not: the state's
   * `rubric` field described a 0–3 ordinal long after the ordinal question
   * became a ladder of booleans, and a related-pair request was judged by
   * rungs that ask about "the query" — a field it does not contain.
   */
  it("no longer describes a scale the model is not asked for", () => {
    const search = buildJevSearchPairRequest({
      query: "commuter research",
      candidateId: "resource-1",
      candidateTitle: "Commuters",
      candidateExcerpt: "Findings about bicycle commuters.",
    });
    if (isJevRequestRejection(search)) throw new Error("unexpected rejection");

    expect(search.serialized).not.toContain("0 unrelated");
    expect(search.serialized).not.toContain("Rate how");
    expect(search.body).not.toHaveProperty("rubric");
    expect(search.body.context).toContain("`query`");
  });

  it("describes the seeds, not a query, for a related pair", () => {
    const related = buildJevRelatedPairRequest({
      seedPassages: ["Bicycle commuters in the Aurora audience."],
      candidateId: "resource-2",
      candidateTitle: "Quarterly strategy",
      candidateExcerpt: "Commuters are one segment we cover.",
    });
    if (isJevRequestRejection(related)) throw new Error("unexpected rejection");

    // The request has no query field, so the prompt must not mention one.
    expect(related.body).not.toHaveProperty("query");
    expect(related.body.context).toContain("`seeds`");
    expect(related.body.context).not.toContain("`query`");
  });

  it("asks a related pair the seed rungs, and a search pair the query rungs", () => {
    const relatedness = RUBRICS.relatedness.map((rung) => rung.id);
    const relevance = RUBRICS.relevance.map((rung) => rung.id);

    // Every relatedness rung talks about the seeds; no relevance rung does.
    for (const rung of RUBRICS.relatedness) {
      expect(rung.instructions).toContain("seed passages");
      expect(rung.instructions).not.toContain("the query");
    }
    for (const rung of RUBRICS.relevance) {
      expect(rung.instructions).toContain("query");
    }
    expect(relatedness).not.toEqual(relevance);

    // Both ladders still span the same 0–3 scale the ranking stage reads.
    expect(RUBRICS.relatedness.map((rung) => rung.score)).toEqual([3, 2, 1]);
  });
});
