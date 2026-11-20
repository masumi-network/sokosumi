import { describe, expect, it } from "vitest";
import { siteStrategyReport } from "@/test-fixtures/project-seo";
import { parsePublicSeoArtifact } from "./project-seo-report";

const raw = siteStrategyReport();
const read = (fields: Record<string, unknown>) =>
  parsePublicSeoArtifact({
    ...raw,
    strategy: { ...raw.strategy, markets: undefined, ...fields },
  }).strategy;
const row = {
  country: "FR",
  language: "fr",
  start: false,
  rivals: 1,
  of: 1,
  share: 0.3,
  etv: 70,
  ownShare: 0,
  hasLanguage: false,
  regionVersion: null,
  candidate: true,
};
const host = {
  host: "example.test",
  role: "site",
  etv: 90,
  fetchedAt: "2026-11-01T12:00:00Z",
  note: null,
};
const markets = {
  rows: [row],
  outside: 0.2,
  siteVisits: true,
  hosts: [host, { ...host, role: "product", host: "product.test", etv: 230 }],
};

describe("site market evidence", () => {
  it("keeps the worker comparison and excludes untrusted source details", () => {
    const result = read({
      markets: {
        ...markets,
        privatePayload: "secret",
        hosts: [
          ...markets.hosts,
          {
            ...host,
            role: "product",
            host: "failed.test",
            etv: null,
            note: "secret",
          },
        ],
      },
    });
    expect(result?.markets).toMatchObject({
      rows: [row],
      outside: 0.2,
      hosts: [
        { unavailable: false },
        { unavailable: false },
        { unavailable: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
  it.each([
    [
      "a local business serves its own area, so no other country was read",
      "local_business",
    ],
    ["the start page's Run found no Market", "missing_baseline"],
    ["the market step failed: private source detail", "read_error"],
    ["the time limit of 120 s had passed by more than 5 s", "time_limit"],
    [
      "the USD limit of 1 has no room for the market reads: details",
      "budget_limit",
    ],
    [
      "The audit did not verify an independent direct business competitor for the market comparison.",
      "unverified_competitors",
    ],
    [
      "The audit could not read the site strategy evidence needed for the market comparison.",
      "strategy_unavailable",
    ],
    ["unknown private note", "unavailable"],
  ])("classifies %s", (marketNote, expected) => {
    expect(read({ marketNote, groups: [] })?.marketNote).toBe(expected);
  });
  it("binds market hosts to the selected start page's retained final URL", () => {
    const page = raw.pages[0];
    const other = {
      ...page,
      request: { url: raw.selection.pages[1].url },
      header: {
        ...page.header,
        finalUrl: { desktop: "https://foreign.test/home" },
      },
    };
    const compare = (
      finalUrl: { desktop?: string | null; mobile?: string | null },
      claimedHost: string,
    ) =>
      parsePublicSeoArtifact({
        ...raw,
        pages: [other, { ...page, header: { ...page.header, finalUrl } }],
        strategy: {
          ...raw.strategy,
          markets: {
            ...markets,
            hosts: [{ ...host, host: claimedHost }, markets.hosts[1]],
          },
        },
      }).strategy?.markets;
    const finals = {
      desktop: "https://www.moved.test/home",
      mobile: "https://mobile-move.test/",
    };
    expect(compare(finals, "moved.test")?.rows).toEqual([row]);
    expect(compare(finals, "mobile-move.test")).toBeUndefined();
    expect(compare(finals, "foreign.test")).toBeUndefined();
    expect(compare(finals, "example.test")).toBeUndefined();
    expect(
      compare({ desktop: null, mobile: finals.mobile }, "mobile-move.test")
        ?.rows,
    ).toEqual([row]);
    expect(
      compare({ desktop: "https://shop.example.test/home" }, "example.test")
        ?.rows,
    ).toEqual([row]);
  });
  it("isolates invalid, foreign and absent market evidence", () => {
    for (const invalid of [
      { ...markets, rows: [{ ...row, share: 2 }] },
      {
        ...markets,
        hosts: [host, { ...host, role: "product", host: "shop.example.test" }],
      },
      {
        ...markets,
        hosts: [{ ...host, host: "foreign.test" }, markets.hosts[1]],
      },
      {},
    ]) {
      const result = read({ markets: invalid });
      expect(result?.verdict).toBe("keep");
      expect(result?.markets).toBeUndefined();
    }
    expect(read({})?.marketNote).toBeUndefined();
    expect(
      read({ business: { competitors: [{ product: false }] } })?.marketNote,
    ).toBe("unverified_competitors");
    expect(
      read({ business: { competitors: [{ product: true }] } })?.marketNote,
    ).toBeUndefined();
  });
});
