import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  CMO_INDUSTRY_COVERAGE_SYSTEM,
  CMO_INDUSTRY_PLAN_SYSTEM,
  CMO_INDUSTRY_RESEARCH_VERSION,
  CMO_INDUSTRY_SYNTHESIS_SYSTEM,
  type CmoIndustryResearch,
  cmoIndustryContext,
  cmoIndustryDue,
  cmoIndustryFromAnswer,
  cmoIndustryNote,
  cmoMergeResults,
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
    version: CMO_INDUSTRY_RESEARCH_VERSION,
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

  // NMKR (2026-11-23): its 11:10 research predated the Haiku plan, and a new
  // strategy reused it.
  it("researches again when the research code is newer than the saved one", () => {
    const now = new Date("2026-11-23T12:00:00Z");
    const { version: _, ...unstamped } = research("2026-11-23T11:10:00Z");
    expect(cmoIndustryDue(unstamped, now)).toBe(true);
    expect(cmoIndustryDue({ ...unstamped, version: 1 }, now)).toBe(true);
    expect(cmoIndustryDue(research("2026-11-23T11:10:00Z"), now)).toBe(false);
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
    version: CMO_INDUSTRY_RESEARCH_VERSION,
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

// Owner, 2026-11-24: NMKR's research leaned on MiCA and tokenized funds; it
// should start from the buyer's own job and fill what it misses.
describe("research of the buyer's job", () => {
  it("plans from the job, keeps what touches it and checks coverage", () => {
    expect(CMO_INDUSTRY_PLAN_SYSTEM).toContain("the buyer's own job");
    expect(CMO_INDUSTRY_PLAN_SYSTEM).toContain("their own ecosystem");
    expect(CMO_INDUSTRY_SYNTHESIS_SYSTEM).toContain(
      "Keep only items that touch the buyer's day-to-day job",
    );
    expect(CMO_INDUSTRY_SYNTHESIS_SYSTEM).toContain(
      "unless the buyers are institutions",
    );
    expect(CMO_INDUSTRY_COVERAGE_SYSTEM).toContain("At most three searches");
    expect(CMO_INDUSTRY_RESEARCH_VERSION).toBe(3);
  });

  it("numbers a gap round's results on from the first, each address once", () => {
    const first = cmoMergeResults(
      [],
      [
        { title: "A", url: "https://a.example/", passages: [] },
        { title: "A again", url: "https://a.example/", passages: [] },
      ],
    );
    expect(first.map((result) => result.id)).toEqual(["r1"]);
    const both = cmoMergeResults(first, [
      { title: "A", url: "https://a.example/", passages: [] },
      { title: "B", url: "https://b.example/", passages: [] },
    ]);
    expect(both.map((result) => `${result.id} ${result.url}`)).toEqual([
      "r1 https://a.example/",
      "r2 https://b.example/",
    ]);
  });
});
