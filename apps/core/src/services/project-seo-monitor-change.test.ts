import { describe, expect, it } from "vitest";

import type { PublicSeoPayload } from "@/helpers/project-seo-report";

import {
  compareSeoMonitorRuns,
  isSeoMonitorChangeWorse,
  isSeoRankMove,
} from "./project-seo-monitor-change";

const PAGE = "https://example.test/pricing";
const AT = "2026-11-01T09:00:00.000Z";

function payload(patch: Partial<PublicSeoPayload> = {}): PublicSeoPayload {
  return {
    version: 1,
    kind: "page_check",
    requestId: null,
    pageUrls: [PAGE],
    observedAt: AT,
    countryCode: "US",
    languageCode: "en",
    rulebookVersion: "r1",
    checks: [],
    keywords: [],
    competitors: [],
    findings: [],
    actions: [],
    coverage: { checked: 0, skipped: 0, failed: 0 },
    notes: [],
    ...patch,
  };
}
const check = (rowId: string, result: "pass" | "fired") => ({
  rowId,
  pageUrl: PAGE,
  device: "desktop" as const,
  result,
});
const finding = (rowId: string, title: string) => ({
  id: rowId,
  rowId,
  title,
  pageUrl: PAGE,
  device: "desktop" as const,
  severity: "major" as const,
  evidence: [],
  sourceRef: "ref",
  observedAt: AT,
});
const ranked = (keyword: string, position: number | null) => ({
  keyword,
  pageUrl: PAGE,
  device: "mobile" as const,
  position,
  positionStatus:
    position === null ? ("not_in_range" as const) : ("ranked" as const),
  checkedResults: 20,
  sourceRef: "ref",
  observedAt: AT,
});
const outside = (
  keyword: string,
  positionStatus: "not_in_range" | "unavailable",
  checkedResults: number | null,
) => ({ ...ranked(keyword, null), positionStatus, checkedResults });
type Serp = NonNullable<PublicSeoPayload["serps"]>[number];
const overview = (
  shown: boolean,
  pageCited: boolean | null,
  asyncLoaded = true,
) => ({ shown, asyncLoaded, citedDomains: [], pageCited });
const serp = (
  aiOverview: Serp["aiOverview"],
  patch: Partial<Serp> = {},
): Serp => ({
  keyword: "x402",
  device: "mobile",
  sourceRef: "ref",
  observedAt: AT,
  itemTypes: [],
  aiOverview,
  featured: null,
  paaOwned: false,
  top: [],
  suspect: false,
  ...patch,
});
const CITED = serp(overview(true, true));
function compare(before: PublicSeoPayload, after: PublicSeoPayload) {
  return compareSeoMonitorRuns(
    { observedAt: new Date("2026-11-01T09:00:00Z"), payload: before },
    { observedAt: new Date("2026-11-08T09:00:00Z"), payload: after },
  );
}

describe("SEO rank noise band (seo-bot research 51)", () => {
  it.each([
    [3, 5, false],
    [3, 6, true],
    [1, 4, true],
    [4, 9, false],
    [4, 10, true],
    [10, 4, true],
    [11, 18, false],
    [11, 19, true],
    [20, 13, false],
    [20, 12, true],
    [21, 1, false],
  ])("from %i to %i is a real move: %s", (from, to, moved) => {
    expect(isSeoRankMove(from, to)).toBe(moved);
  });
});

describe("compareSeoMonitorRuns", () => {
  it("names checks that started failing and checks that were fixed, with their titles", () => {
    const change = compare(
      payload({
        checks: [check("title", "pass"), check("h1", "fired")],
        findings: [finding("h1", "Missing H1")],
      }),
      payload({
        checks: [check("title", "fired"), check("h1", "pass")],
        findings: [finding("title", "Title too long")],
      }),
    );
    expect(change).toMatchObject({
      comparable: true,
      newFailureCount: 1,
      fixedCount: 1,
      newFailures: [{ rowId: "title", title: "Title too long" }],
      fixed: [{ rowId: "h1", title: "Missing H1" }],
    });
    expect(isSeoMonitorChangeWorse(change)).toBe(true);
  });

  it("ignores checks one of the two Runs did not read", () => {
    const change = compare(
      payload({ checks: [check("title", "pass")] }),
      payload({
        checks: [
          { ...check("title", "fired"), device: "mobile" },
          check("h1", "fired"),
        ],
      }),
    );
    expect(change.newFailureCount).toBe(0);
    expect(isSeoMonitorChangeWorse(change)).toBe(false);
  });

  it("counts a ranked keyword that fell beyond the band, and never an unread one as a drop", () => {
    const change = compare(
      payload({
        keywords: [
          ranked("agent payments", 2),
          ranked("x402", 12),
          ranked("stablecoin api", 5),
          ranked("gone", 3),
        ],
      }),
      payload({
        keywords: [
          ranked("Agent Payments", 6),
          ranked("x402", 4),
          ranked("stablecoin api", 9),
          outside("gone", "unavailable", null),
        ],
      }),
    );
    expect(change.moves).toEqual([
      expect.objectContaining({ keyword: "Agent Payments", from: 2, to: 6 }),
      expect.objectContaining({ keyword: "x402", from: 12, to: 4 }),
    ]);
    expect(change).toMatchObject({ moveCount: 2, dropCount: 1 });
    expect(isSeoMonitorChangeWorse(change)).toBe(true);
  });

  it("names a keyword that left a deep enough read, first, and counts it as a drop", () => {
    const change = compare(
      payload({ keywords: [ranked("x402", 15), ranked("agent payments", 5)] }),
      payload({
        keywords: [
          ranked("x402", 3),
          outside("agent payments", "not_in_range", 20),
        ],
      }),
    );
    expect(change.moves).toEqual([
      expect.objectContaining({
        keyword: "agent payments",
        from: 5,
        to: null,
        checkedResults: 20,
      }),
      expect.objectContaining({ keyword: "x402", from: 15, to: 3 }),
    ]);
    expect(change).toMatchObject({ moveCount: 2, dropCount: 1 });
    expect(isSeoMonitorChangeWorse(change)).toBe(true);
  });

  it.each([
    ["a failed or suspect read", 5, outside("kw", "unavailable", null)],
    ["a read with no result count", 5, outside("kw", "not_in_range", null)],
    ["a read no deeper than the band", 5, outside("kw", "not_in_range", 10)],
    ["a start rank past the top 10", 15, outside("kw", "not_in_range", 100)],
  ])("does not count a keyword missing from %s as a drop", (_, from, row) => {
    const change = compare(
      payload({ keywords: [ranked("kw", from)] }),
      payload({ keywords: [row] }),
    );
    expect(change).toMatchObject({ moves: [], dropCount: 0 });
    expect(isSeoMonitorChangeWorse(change)).toBe(false);
  });

  it("is not worse when ranks only rose", () => {
    const change = compare(
      payload({ keywords: [ranked("x402", 15)] }),
      payload({ keywords: [ranked("x402", 3)] }),
    );
    expect(change.dropCount).toBe(0);
    expect(isSeoMonitorChangeWorse(change)).toBe(false);
  });

  it.each([
    ["names other sources", overview(true, false), true],
    ["is gone after the read waited for it", overview(false, false), false],
  ])("counts a lost citation when the AI Overview %s", (_, now, shown) => {
    const change = compare(
      payload({ serps: [CITED] }),
      // Another letter case and a second read of the same keyword: one loss.
      payload({ serps: [serp(now, { keyword: "X402" }), serp(now)] }),
    );
    expect(change.lostCitations).toEqual([
      { keyword: "X402", device: "mobile", shown },
    ]);
    expect(change.lostCitationCount).toBe(1);
    expect(isSeoMonitorChangeWorse(change)).toBe(true);
  });

  it.each([
    ["the page is still cited", [CITED], [CITED], {}],
    [
      "the earlier read was suspect",
      [serp(overview(true, true), { suspect: true })],
      [serp(overview(true, false))],
      {},
    ],
    [
      "the earlier citation was not determined",
      [serp(overview(true, null))],
      [serp(overview(true, false))],
      {},
    ],
    [
      "the earlier AI Overview was not shown",
      [serp(overview(false, true))],
      [serp(overview(true, false))],
      {},
    ],
    [
      "the latest read is suspect",
      [CITED],
      [serp(overview(true, false), { suspect: true })],
      {},
    ],
    ["the latest read has no AI Overview data", [CITED], [serp(null)], {}],
    [
      "the latest citation is not determined",
      [CITED],
      [serp(overview(true, null))],
      {},
    ],
    [
      "the latest read did not wait for the AI Overview",
      [CITED],
      [serp(overview(false, false, false))],
      {},
    ],
    [
      "the loss is on the other device",
      [CITED],
      [serp(overview(true, false), { device: "desktop" })],
      {},
    ],
    [
      "the latest Run checked other pages",
      [CITED],
      [serp(overview(true, false))],
      { pageUrls: [PAGE, "https://example.test/docs"] },
    ],
    ["the latest Run has no SERP reads", [CITED], undefined, {}],
  ])("has no lost citation when %s", (_, before, after, patch) => {
    const change = compare(
      payload({ serps: before }),
      payload({ serps: after, ...patch }),
    );
    expect(change).toMatchObject({ lostCitations: [], lostCitationCount: 0 });
    expect(isSeoMonitorChangeWorse(change)).toBe(false);
  });

  it("compares nothing across another Market or rulebook", () => {
    const before = payload({ checks: [check("title", "pass")] });
    for (const patch of [
      { countryCode: "DE" },
      { languageCode: "de" },
      { rulebookVersion: "r2" },
    ]) {
      const change = compare(
        before,
        payload({ ...patch, checks: [check("title", "fired")] }),
      );
      expect(change).toMatchObject({ comparable: false, newFailureCount: 0 });
      expect(isSeoMonitorChangeWorse(change)).toBe(false);
    }
  });
});
