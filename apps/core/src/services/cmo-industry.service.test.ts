import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  type CmoIndustryResearch,
  cmoIndustryContext,
  cmoIndustryDue,
  cmoIndustryFromAnswer,
  cmoIndustryNote,
  cmoReadsIndustry,
} from "./cmo-industry.service";
import {
  cmoPillarFactProblems,
  cmoTopicPillarFacts,
} from "./cmo-plan-review.service";

const result = (id: string, url: string, publishedDate?: string) => ({
  id,
  title: `Title ${id}`,
  url,
  passages: [],
  ...(publishedDate ? { publishedDate } : {}),
});

describe("cmoIndustryDue", () => {
  const research = (researchedAt: string, items = 1) => ({
    researchedAt,
    items: Array.from({ length: items }, () => ({}) as never),
  });

  it("researches a Cuso that has none, and again from the 25th", () => {
    expect(cmoIndustryDue(null, new Date("2026-11-23T10:00:00Z"))).toBe(true);
    const nov23 = research("2026-11-23T10:00:00Z");
    expect(cmoIndustryDue(nov23, new Date("2026-11-24T10:00:00Z"))).toBe(false);
    expect(cmoIndustryDue(nov23, new Date("2026-11-25T00:00:00Z"))).toBe(true);
    const nov25 = research("2026-11-25T08:00:00Z");
    expect(cmoIndustryDue(nov25, new Date("2026-11-27T09:00:00Z"))).toBe(false);
    expect(cmoIndustryDue(nov25, new Date("2026-12-24T09:00:00Z"))).toBe(false);
    expect(cmoIndustryDue(nov25, new Date("2026-12-25T09:00:00Z"))).toBe(true);
  });

  it("tries an empty research again after six hours", () => {
    const empty = research("2026-11-23T10:00:00Z", 0);
    expect(cmoIndustryDue(empty, new Date("2026-11-23T15:00:00Z"))).toBe(false);
    expect(cmoIndustryDue(empty, new Date("2026-11-23T16:00:00Z"))).toBe(true);
  });
});

describe("cmoIndustryFromAnswer", () => {
  it("keeps only items with a real result as source, with its address and date", () => {
    const found = cmoIndustryFromAnswer({
      results: [
        result("r1", "https://news.example/a", "2026-11-10"),
        result("r2", "https://blog.example/b"),
      ],
      answer: {
        items: [
          { kind: "news", point: "Cardano fees fell.", source: "r1" },
          { kind: "trend", point: "Made up.", source: "r9" },
          { kind: "problem", point: "Launches fail on demand.", source: "r2" },
          { kind: "problem", point: "Launches fail on demand.", source: "r2" },
        ],
        topics: [
          { name: "Launch demand", why: "What sells out", items: [2, 3, 4] },
          { name: "Nothing", why: "Rests on no kept item", items: [2] },
        ],
      },
    });
    expect(found.items).toEqual([
      {
        id: "i1",
        kind: "news",
        point: "Cardano fees fell.",
        date: "2026-11-10",
        sourceTitle: "Title r1",
        sourceUrl: "https://news.example/a",
      },
      {
        id: "i2",
        kind: "problem",
        point: "Launches fail on demand.",
        date: null,
        sourceTitle: "Title r2",
        sourceUrl: "https://blog.example/b",
      },
    ]);
    expect(found.topics).toEqual([
      { name: "Launch demand", why: "What sells out", itemIds: ["i2"] },
    ]);
  });
});

describe("the research as Cuso reads it", () => {
  const research: CmoIndustryResearch = {
    researchedAt: "2026-11-23T10:00:00.000Z",
    industry: "Token launches on Cardano",
    buyer: "Founders launching a token",
    items: [
      {
        id: "i1",
        kind: "news",
        point: "Cardano fees fell.",
        date: "2026-11-10",
        sourceTitle: "News",
        sourceUrl: "https://news.example/a",
      },
    ],
    topics: [
      { name: "Launch costs", why: "What a launch costs", itemIds: ["i1"] },
    ],
  };

  it("gives each item its id, date and source in one line", () => {
    expect(cmoIndustryContext(research)).toEqual({
      researchedAt: "2026-11-23",
      industry: "Token launches on Cardano",
      buyer: "Founders launching a token",
      items: [
        "i1 · news · 2026-11-10 · Cardano fees fell. (source: News, https://news.example/a)",
      ],
      topics: ["Launch costs: What a launch costs (i1)"],
    });
    expect(cmoIndustryNote(research)).toContain(
      "- i1 (2026-11-10): Cardano fees fell. [News](https://news.example/a)",
    );
  });

  it("is read by cmo-v21 only", () => {
    expect(cmoReadsIndustry("cmo-v21")).toBe(true);
    expect(cmoReadsIndustry("cmo-v20")).toBe(false);
  });
});

describe("cmo-v21's pillar check", () => {
  it("names a pillar that is a step of using the product", async () => {
    const counted = await cmoTopicPillarFacts(
      {
        pillars: [
          { name: "Choose Minting Setup", share: 50 },
          { name: "Launch demand", share: 50 },
        ],
        offer: null as never,
      },
      [
        { id: "i1", point: "a" },
        { id: "i2", point: "b" },
        { id: "i3", point: "c" },
      ],
      async () => ({
        output: {
          pillars: [
            { id: "p1", itemIds: ["i1"], productStep: true },
            { id: "p2", itemIds: ["i1", "i2", "i3"], productStep: false },
          ],
        } as never,
        costUsd: 0.001,
      }),
    );
    const problems = cmoPillarFactProblems(counted.pillars, "industry");
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /"Choose Minting Setup" is a step of using the product/,
    );
  });

  it("counts a thin topic against the industry research", () => {
    expect(
      cmoPillarFactProblems(
        [
          { name: "A", share: 50, facts: ["a"] },
          { name: "B", share: 50, facts: ["b", "c", "d"] },
        ],
        "industry",
      )[0],
    ).toMatch(/"A" rests on one fact from the industry research/);
  });
});
