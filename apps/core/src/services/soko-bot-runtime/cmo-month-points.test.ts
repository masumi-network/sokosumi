import { describe, expect, it } from "vitest";
import {
  cmoCapPoints,
  cmoOfferLinkProblem,
  cmoOfferPieceIds,
  cmoPointCap,
  cmoSourcedPoints,
} from "./cmo-month-points";

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    date: "2026-11-23",
    channel: "x",
    format: "post",
    title: id,
    status: "idea",
    approach: "educational",
    pillar: "Owner control",
    ...extra,
  } as never;
}

const funnel = [
  {
    stage: "awareness",
    goal: "g",
    owner: "cuso",
    channels: ["tiktok"],
    plays: [],
  },
  { stage: "action", goal: "g", owner: "cuso", channels: ["x"], plays: [] },
] as never;

describe("cmoOfferPieceIds", () => {
  it("marks two pieces a week on each action network, product pieces first, on different days", () => {
    const calendar = [
      entry("a", { date: "2026-11-23", approach: "product-led" }),
      entry("b", { date: "2026-11-23", approach: "product-led" }),
      entry("c", { date: "2026-11-24" }),
      entry("d", { date: "2026-11-25", approach: "promotional" }),
      entry("e", { date: "2026-11-30" }),
      entry("f", { date: "2026-12-01" }),
      entry("g", { date: "2026-12-02" }),
      entry("t", { channel: "tiktok", approach: "promotional" }),
      entry("v", { videoOf: "a", approach: "promotional" }),
    ];
    expect([...cmoOfferPieceIds({ funnel, calendar })].sort()).toEqual([
      "a",
      "d",
      "e",
      "f",
    ]);
  });

  it("marks nothing without an action stage", () => {
    expect(cmoOfferPieceIds({ funnel: [], calendar: [entry("a")] }).size).toBe(
      0,
    );
  });
});

describe("cmoOfferLinkProblem", () => {
  it("needs the link in the first comment on X, and the bio on TikTok", () => {
    expect(
      cmoOfferLinkProblem("x", {
        draft: "Open one. Link below.",
        firstComment: null,
      }),
    ).toMatch(/firstComment/);
    expect(
      cmoOfferLinkProblem("x", {
        draft: "Open one. Link below.",
        firstComment: "https://entry.fyi",
      }),
    ).toBeNull();
    expect(
      cmoOfferLinkProblem("tiktok", {
        draft: "Try it, link in bio.",
        firstComment: null,
      }),
    ).toBeNull();
    expect(
      cmoOfferLinkProblem("tiktok", { draft: "Try it.", firstComment: null }),
    ).toMatch(/bio/);
  });
});

describe("cmoCapPoints", () => {
  it("holds one point to its cap per network and moves the rest to the pillar's least used point", () => {
    const calendar = Array.from({ length: 6 }, (_, n) => entry(`p${n}`));
    const claims = cmoCapPoints({
      calendar: [
        ...calendar,
        entry("done", { claim: "You approve what goes live" }),
      ],
      points: [
        {
          id: "a",
          pillar: "Owner control",
          factId: "Owners approve changes",
          point: "You approve what goes live",
        },
        // The same fact in other words: it shares the cap.
        {
          id: "a2",
          pillar: "Owner control",
          factId: "Owners approve changes",
          point: "Nothing changes until you say yes",
        },
        {
          id: "b",
          pillar: "Owner control",
          factId: "Sources: GitHub, site, X",
          point: "Suggestions come from GitHub and X",
        },
        {
          id: "c",
          pillar: "Page setup",
          factId: "Previews expire after 24 hours",
          point: "An unclaimed preview is deleted after 24 hours",
        },
      ],
      picks: new Map(
        calendar.map((one: { id: string }, n) => [one.id, n % 2 ? "a2" : "a"]),
      ),
    });
    const counts = new Map<string, number>();
    for (const point of claims.values())
      counts.set(point, (counts.get(point) ?? 0) + 1);
    // 7 X pieces: a cap of 2, one already taken by "done".
    expect(cmoPointCap(7)).toBe(2);
    // One fact, worded two ways, still one slot left after "done".
    expect(
      (counts.get("You approve what goes live") ?? 0) +
        (counts.get("Nothing changes until you say yes") ?? 0),
    ).toBe(1);
    // Its own pillar's other fact first, then the month's.
    expect(counts.get("Suggestions come from GitHub and X")).toBe(2);
    expect(counts.get("An unclaimed preview is deleted after 24 hours")).toBe(
      2,
    );
    expect(claims.size).toBe(5);
  });
});

describe("cmoSourcedPoints", () => {
  it("gives a point on an industry item its source", () => {
    const industry = [
      { id: "i1", point: "Fees fell", sourceUrl: "https://news.example/a" },
    ];
    const [onItem, onBrand, long] = cmoSourcedPoints(
      [
        { id: "a", pillar: "P", factId: "i1", point: "Fees fell this month" },
        { id: "b", pillar: "P", factId: "f1", point: "Studio is free" },
        { id: "c", pillar: "P", factId: "i1", point: "x".repeat(390) },
      ],
      industry,
    );
    expect(onItem?.point).toBe(
      "Fees fell this month (source: https://news.example/a)",
    );
    expect(onBrand?.point).toBe("Studio is free");
    expect(long?.point).toBe(`${"x".repeat(390)} (source: i1)`);
  });
});
