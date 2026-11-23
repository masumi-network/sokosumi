import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/brand-brain.service", () => ({
  compactBrandBrain: () => ({ summary: "Entry" }),
}));

import {
  cmoPillarFactProblems,
  cmoPillarFacts,
} from "./cmo-plan-review.service";

describe("cmoPillarFactProblems", () => {
  it("names a pillar on fewer than three facts, and one far past its share of them", () => {
    const problems = cmoPillarFactProblems([
      {
        name: "Owner control",
        share: 25,
        facts: ["You approve what goes live"],
      },
      { name: "Page setup", share: 65, facts: ["a", "b", "c"] },
      {
        name: "Current work",
        share: 10,
        facts: ["d", "e", "f", "g", "h", "i"],
      },
    ]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/"Owner control" rests on one fact/);
    expect(problems[0]).toMatch(/Merge it into another pillar or reframe it/);
    // 3 of 10 facts carry at most 60%; Page setup holds 65.
    expect(problems[1]).toMatch(/"Page setup" holds 65% .* at most 60%/);
  });

  it("passes pillars that each rest on enough facts", () => {
    expect(
      cmoPillarFactProblems([
        { name: "A", share: 50, facts: ["a", "b", "c"] },
        { name: "B", share: 50, facts: ["d", "e", "f"] },
      ]),
    ).toEqual([]);
  });

  it("names a reassurance pillar whatever its facts", () => {
    const [problem] = cmoPillarFactProblems([
      {
        name: "You approve every update",
        share: 25,
        facts: ["a", "b", "c", "d"],
        reassurance: true,
      },
      { name: "B", share: 75, facts: ["e", "f", "g"] },
    ]);
    expect(problem).toMatch(/"You approve every update" is a reassurance line/);
  });
});

describe("cmoPillarFacts", () => {
  it("maps the model's fact ids to each pillar, a fact once", async () => {
    const ask = vi.fn().mockResolvedValue({
      output: {
        facts: [
          { id: "f1", fact: "Owners approve changes" },
          { id: "f2", fact: "Drafts from GitHub, site and X" },
        ],
        pillars: [
          {
            id: "p1",
            factIds: ["f1", "f1", "f9"],
            reassurance: true,
          },
          { id: "p2", factIds: ["f2"], reassurance: false },
        ],
      },
      costUsd: 0.001,
    });
    const result = await cmoPillarFacts(
      {
        pillars: [
          { name: "Owner control", share: 50, why: "w" },
          { name: "Page setup", share: 50, why: "w" },
        ],
        offer: undefined,
      } as never,
      { products: [], offers: [] } as never,
      ask as never,
    );
    expect(ask.mock.calls[0]![0].prompt).not.toContain("site's pages");
    expect(result.pillars).toEqual([
      {
        name: "Owner control",
        share: 50,
        reassurance: true,
        facts: ["Owners approve changes"],
      },
      {
        name: "Page setup",
        share: 50,
        facts: ["Drafts from GitHub, site and X"],
      },
    ]);
  });

  it("reads the site's page facts beside the Brand Brain", async () => {
    const ask = vi.fn().mockResolvedValue({
      output: { facts: [], pillars: [] },
      costUsd: 0,
    });
    await cmoPillarFacts(
      { pillars: [{ name: "A", share: 100, why: "w" }] } as never,
      {} as never,
      ask as never,
      ["Pro is 9 USD a month with your own domain"],
    );
    expect(ask.mock.calls[0]![0].prompt).toContain(
      "- Pro is 9 USD a month with your own domain",
    );
  });
});
